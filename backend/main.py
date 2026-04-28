"""
Vision2Voice analysis API: download clip → frame sampling → vision (OpenAI or fallback)
→ retrieve stats from local knowledge → commentary (OpenAI or template).
"""

from __future__ import annotations

import base64
import asyncio
import json
import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

from jersey_resolve import enrich_timeline_segments, enrich_vision_with_nba_rosters
from live_game_data import nba_team_options, search_nba_games
from live_sessions import LiveSessionConfig, LiveSessionManager
from openai_retry import with_openai_retry
from timeline import (
    commentary_lines_for_timeline,
    normalize_timeline,
    template_lines_for_timeline,
    visual_summary_from_timeline,
)
from voiceover_export import build_voiceover_mp4, build_voiceover_timeline_mp4

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("vision2voice")

APP_DIR = Path(__file__).resolve().parent
load_dotenv(APP_DIR / ".env")

KNOWLEDGE_PATH = APP_DIR / "data" / "knowledge.json"

EVENT_TYPES = [
    "Three-Point Shot",
    "Two-Point Shot",
    "Layup or Dunk",
    "Free Throw",
    "Assist",
    "Rebound",
    "Turnover",
    "Block",
    "Foul",
    "Other",
]

app = FastAPI(title="Vision2Voice Backend", version="0.1.0")

_cors_raw = os.getenv("CORS_ORIGINS", "*").strip()
_cors_origins = [o.strip() for o in _cors_raw.split(",") if o.strip()] if _cors_raw != "*" else ["*"]
# Any localhost / 127.0.0.1 port (Vite picks 5173, 8080, 8081, … when busy)
_localhost_regex = r"https?://(localhost|127\.0\.0\.1)(:\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=None if _cors_origins == ["*"] else _localhost_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ClipRequest(BaseModel):
    clip_id: str
    file_url: str


class VoiceoverExportBody(BaseModel):
    file_url: str
    commentary_text: str = ""
    possession_timeline: list[dict[str, Any]] | None = None
    segment_commentary_lines: list[str] | None = None


class LiveSessionRequest(BaseModel):
    file_url: str
    nba_game_id: str
    start_period: int = Field(default=1, ge=1, le=10)
    start_clock: str = "12:00"
    cadence_sec: float = Field(default=3.0, ge=1.0, le=10.0)
    window_sec: float = Field(default=6.0, ge=2.0, le=20.0)
    replay_speed: float = Field(default=1.0, ge=0.25, le=8.0)
    clock_mode: str = "replay_media"


class LivePlaybackControlRequest(BaseModel):
    state: str = Field(pattern="^(playing|paused)$")
    replay_time_sec: float = Field(default=0.0, ge=0.0)
    playback_rate: float = Field(default=1.0, ge=0.1, le=8.0)


class LiveSessionResponse(BaseModel):
    session_id: str
    status: str
    team_names: list[str] = Field(default_factory=list)
    event_count: int = 0
    warnings: list[str] = Field(default_factory=list)


class LiveUploadResponse(BaseModel):
    upload_id: str
    file_url: str
    filename: str
    size_bytes: int


class LiveTeamOptionResponse(BaseModel):
    team_id: str
    name: str
    abbreviation: str | None = None
    city: str | None = None


class LiveGameSearchResultResponse(BaseModel):
    game_id: str
    game_date: str
    season: str
    season_type: str
    matchup: str
    team_abbreviation: str
    opponent_abbreviation: str
    home_team: str | None = None
    away_team: str | None = None
    team_score: int | None = None
    opponent_score: int | None = None
    score: str | None = None
    result: str | None = None


def _unlink_temp(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


class AnalysisResult(BaseModel):
    event_type: str
    player_name: str
    team_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    visual_summary: str
    retrieved_context: dict[str, Any] | None = None
    commentary_text: str
    model_name: str = "vision2voice-v1"
    possession_timeline: list[dict[str, Any]] = Field(default_factory=list)
    segment_commentary_lines: list[str] = Field(default_factory=list)


def load_knowledge() -> dict[str, Any]:
    if not KNOWLEDGE_PATH.exists():
        return {"players": [], "teams": []}
    with KNOWLEDGE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def _normalize(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower().strip())


def retrieve_context(player_name: str, team_name: str) -> dict[str, Any]:
    data = load_knowledge()
    pn = _normalize(player_name)
    tn = _normalize(team_name)

    player_stats: dict[str, Any] | None = None
    team_stats: dict[str, Any] | None = None

    for p in data.get("players", []):
        for alias in p.get("aliases", []):
            na = _normalize(alias)
            if na and (na in pn or pn in na or na in pn):
                player_stats = {k: v for k, v in p.items() if k not in ("aliases", "display_name", "notes")}
                player_stats["name"] = p.get("display_name", player_name)
                break
        if player_stats:
            break

    for t in data.get("teams", []):
        for alias in t.get("aliases", []):
            na = _normalize(alias)
            if na and (na in tn or tn in na):
                team_stats = {k: v for k, v in t.items() if k not in ("aliases", "display_name")}
                team_stats["name"] = t.get("display_name", team_name)
                break
        if team_stats:
            break

    return {
        "player_stats": player_stats or {},
        "team_stats": team_stats or {},
    }


def extract_frames(video_path: str, n: int = 16) -> list[bytes]:
    import cv2

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Could not open video (install OpenCV codecs or use MP4/H.264)")

    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        # Evenly sample from first → last frame so the model sees the whole play in time order
        if total <= 1:
            indices = [0]
        else:
            n = min(max(n, 2), total)
            indices = sorted(
                {min(total - 1, int(round(i * (total - 1) / (n - 1)))) for i in range(n)}
            )
        frames: list[bytes] = []
        for idx in indices:
            cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
            ok, frame = cap.read()
            if ok and frame is not None:
                _, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
                frames.append(buf.tobytes())
        if not frames:
            raise RuntimeError("No frames decoded from video")
        return frames
    finally:
        cap.release()


async def download_video(url: str) -> str:
    async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        fd, path = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)
        with open(path, "wb") as f:
            f.write(r.content)
        return path


def _b64_data_url(jpeg_bytes: bytes) -> str:
    b64 = base64.standard_b64encode(jpeg_bytes).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


async def vision_with_openai(frames: list[bytes]) -> dict[str, Any]:
    import asyncio

    from openai import AsyncOpenAI

    client = AsyncOpenAI()
    img_detail = os.getenv("OPENAI_VISION_IMAGE_DETAIL", "high").lower()
    if img_detail not in ("low", "high", "auto"):
        img_detail = "high"

    nf = len(frames)
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "You analyze a short NBA/basketball TV broadcast clip. Frames run in chronological order "
                "from the START to the END of the clip—use every frame for motion, ball, and defense.\n\n"
                "BALL / POSSESSION: Track who has the ball at each point in time. When the ball is passed, "
                "stolen, rebounded, or handed off, the primary player and team for that moment MUST change "
                "to the new ball-handler.\n\n"
                "Prioritize UNIFORM EVIDENCE:\n"
                "- Read jersey numbers (digits on front/back; may be blurry—best effort).\n"
                "- Describe jersey and trim COLORS (e.g. road black, home white, statement gold) for the "
                "main player involved and defenders when visible.\n"
                "- Use scorebug, baseline text, arena signage, or court logo text if readable to infer team.\n"
                "- If a name is visible on the jersey back or bug, use it.\n\n"
                "Reply with ONLY valid JSON (no markdown) and these keys:\n"
                f'- event_type: one of {", ".join(EVENT_TYPES)} (overall dominant play or first beat)\n'
                "- player_name: who has the ball at the START of the clip (or primary actor)\n"
                "- team_name: their team\n"
                "- jersey_number_primary: string, the main actor's jersey # you are most confident about, or null\n"
                "- jersey_numbers_visible: array of strings, other visible numbers\n"
                "- jersey_kit_description: short phrase (colors, home/away if obvious)\n"
                "- team_name_from_visuals: team hint from uniforms/court alone (or null)\n"
                "- team_name_from_scoreboard: exact text snippet from bug if seen (or null)\n"
                "- team_colors_description: colors for the focal player's team\n"
                "- confidence: 0-1\n"
                "- visual_summary: 2-5 sentences, factual, cite jerseys/numbers/colors when possible; "
                "must describe the SAME chronological ball/possession flow as your segments (no contradictions).\n"
                "- segments: REQUIRED non-empty array. Each item: "
                '{"t0": float 0-1, "t1": float 0-1, "event_type": one of EVENT_TYPES, '
                '"player_name": string (ball-handler in [t0,t1)), "team_name": string, '
                '"jersey_number_primary": string or null}. '
                "Cover the full clip: first segment t0=0, last t1=1; no gaps (each t1 equals next t0). "
                "Split when possession or clear event changes (pass, shot, rebound, steal, etc.)."
            ),
        }
    ]
    for i, fb in enumerate(frames):
        pct = 100.0 * i / (nf - 1) if nf > 1 else 0.0
        content.append({"type": "text", "text": f"Frame {i + 1} (~{pct:.0f}% through clip time):"})
        content.append(
            {"type": "image_url", "image_url": {"url": _b64_data_url(fb), "detail": img_detail}}
        )

    async def _vision_call():
        return await client.chat.completions.create(
            model=os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": content}],
            response_format={"type": "json_object"},
            max_tokens=1600,
        )

    resp = await with_openai_retry(_vision_call, label="vision")
    raw = resp.choices[0].message.content or "{}"
    data: dict[str, Any] = json.loads(raw)

    et = data.get("event_type", "Other")
    if et not in EVENT_TYPES:
        data["event_type"] = "Other"
    else:
        data["event_type"] = et

    data["player_name"] = str(data.get("player_name", "Unknown")).strip() or "Unknown"
    data["team_name"] = str(data.get("team_name", "Unknown")).strip() or "Unknown"
    try:
        data["confidence"] = float(data.get("confidence", 0.5))
    except (TypeError, ValueError):
        data["confidence"] = 0.5
    data["visual_summary"] = str(data.get("visual_summary", "")).strip() or "No summary produced."

    valid_events = set(EVENT_TYPES)
    raw_segs = data.get("segments")
    segments_in: list[dict[str, Any]] = raw_segs if isinstance(raw_segs, list) else []
    segments = normalize_timeline(segments_in, data, valid_events)

    nba_on = os.getenv("NBA_ROSTER_LOOKUP", "1").lower() not in ("0", "false", "no", "off")
    if nba_on and segments:
        await asyncio.to_thread(enrich_timeline_segments, segments)

    if segments:
        s0 = segments[0]
        data["event_type"] = s0["event_type"]
        data["player_name"] = s0["player_name"]
        data["team_name"] = s0["team_name"]
        jp = s0.get("jersey_number_primary")
        if jp:
            data["jersey_number_primary"] = jp

    if nba_on:
        await asyncio.to_thread(enrich_vision_with_nba_rosters, data)

    return {
        "event_type": data["event_type"],
        "player_name": data["player_name"],
        "team_name": data["team_name"],
        "confidence": max(0.0, min(1.0, float(data["confidence"]))),
        "visual_summary": data["visual_summary"],
        "segments": segments,
    }


def vision_fallback() -> dict[str, Any]:
    return {
        "event_type": "Other",
        "player_name": "Unknown",
        "team_name": "Unknown",
        "confidence": 0.15,
        "visual_summary": (
            "Vision model is not configured. Set OPENAI_API_KEY on the backend "
            "to enable frame-based event and scene understanding."
        ),
        "segments": normalize_timeline(
            [],
            {
                "event_type": "Other",
                "player_name": "Unknown",
                "team_name": "Unknown",
            },
            set(EVENT_TYPES),
        ),
    }


async def commentary_with_openai(
    structured: dict[str, Any],
    retrieved: dict[str, Any],
    temperature: float = 0.75,
) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI()
    player_blob = json.dumps(retrieved.get("player_stats") or {}, indent=2)
    team_blob = json.dumps(retrieved.get("team_stats") or {}, indent=2)
    prompt = f"""Write 2-4 sentences of live TV basketball commentary (energetic but factual).

Detected play:
- Event: {structured["event_type"]}
- Player (estimate): {structured["player_name"]}
- Team (estimate): {structured["team_name"]}
- Visual summary: {structured["visual_summary"]}

Retrieved stats (may be empty if unknown — do not invent numbers not listed):
Player stats JSON:
{player_blob}

Team stats JSON:
{team_blob}

Rules: If stats are empty, describe only the action. Do not fabricate specific statistics."""
    async def _commentary_call():
        return await client.chat.completions.create(
            model=os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=350,
        )

    resp = await with_openai_retry(_commentary_call, label="commentary")
    return (resp.choices[0].message.content or "").strip()


def commentary_template(structured: dict[str, Any], retrieved: dict[str, Any]) -> str:
    ps = retrieved.get("player_stats") or {}
    ts = retrieved.get("team_stats") or {}
    name = ps.get("name") or structured["player_name"]
    team = ts.get("name") or structured["team_name"]
    bits = [f"{structured['event_type']} on the floor."]
    if name and name != "Unknown":
        bits.append(f"{name} is involved in the play.")
    if ps.get("season_avg_ppg") is not None:
        bits.append(f"He's averaging about {ps['season_avg_ppg']} points per game this season.")
    if team and team != "Unknown" and ts.get("win_loss"):
        bits.append(f"{team} sits at {ts['win_loss']} on the year.")
    bits.append(structured["visual_summary"][:200] + ("…" if len(structured["visual_summary"]) > 200 else ""))
    return " ".join(bits)


async def supabase_get_latest(
    table: str,
    clip_id: str,
) -> dict[str, Any] | None:
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        return None
    url = f"{base}/rest/v1/{table}"
    params = {
        "select": "*",
        "clip_id": f"eq.{clip_id}",
        "order": "created_at.desc",
        "limit": "1",
    }
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params=params, headers=headers)
        if r.status_code != 200:
            logger.warning("Supabase %s fetch failed: %s %s", table, r.status_code, r.text)
            return None
        rows = r.json()
        return rows[0] if rows else None


def row_to_retrieved(row: dict[str, Any] | None) -> dict[str, Any]:
    if not row:
        return {"player_stats": {}, "team_stats": {}}
    return {
        "player_stats": row.get("player_stats_json") or {},
        "team_stats": row.get("team_stats_json") or {},
    }


def row_to_structured(det: dict[str, Any] | None) -> dict[str, Any] | None:
    if not det:
        return None
    return {
        "event_type": det.get("event_type") or "Other",
        "player_name": det.get("player_name") or "Unknown",
        "team_name": det.get("team_name") or "Unknown",
        "confidence": float(det.get("confidence") or 0.5),
        "visual_summary": det.get("visual_summary") or "",
    }


async def persist_to_supabase(
    clip_id: str,
    result: AnalysisResult,
    *,
    commentary_only: bool = False,
) -> None:
    """Mirror Edge Function DB writes when using direct frontend → backend mode."""
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        return

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    rc = result.retrieved_context
    ps = rc.get("player_stats") if rc else None
    ts = rc.get("team_stats") if rc else None

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if not commentary_only:
                r1 = await client.post(
                    f"{base}/rest/v1/detections",
                    headers=headers,
                    json={
                        "clip_id": clip_id,
                        "event_type": result.event_type,
                        "player_name": result.player_name,
                        "team_name": result.team_name,
                        "confidence": result.confidence,
                        "visual_summary": result.visual_summary,
                    },
                )
                r1.raise_for_status()
                r2 = await client.post(
                    f"{base}/rest/v1/retrieved_context",
                    headers=headers,
                    json={
                        "clip_id": clip_id,
                        "player_stats_json": ps,
                        "team_stats_json": ts,
                    },
                )
                r2.raise_for_status()
            r3 = await client.post(
                f"{base}/rest/v1/commentaries",
                headers=headers,
                json={
                    "clip_id": clip_id,
                    "model_name": result.model_name,
                    "commentary_text": result.commentary_text,
                },
            )
            r3.raise_for_status()
    except Exception as e:
        logger.warning("Supabase persist failed (results still returned): %s", e)


async def persist_live_event_to_supabase(session_id: str, event: dict[str, Any]) -> None:
    """Persist compact live session/caption review data when Supabase service keys exist."""
    base = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base or not key:
        return

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    event_type = event.get("type")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if event_type == "session_ready":
                await client.post(
                    f"{base}/rest/v1/live_sessions",
                    headers=headers,
                    json={
                        "id": session_id,
                        "file_url": event.get("file_url"),
                        "nba_game_id": event.get("game_id"),
                        "start_period": event.get("start_period"),
                        "start_clock": event.get("start_clock"),
                        "cadence_sec": event.get("cadence_sec"),
                        "window_sec": event.get("window_sec"),
                        "status": event.get("status"),
                        "warnings_json": event.get("warnings") or [],
                    },
                )
            elif event_type == "caption":
                await client.post(
                    f"{base}/rest/v1/live_captions",
                    headers=headers,
                    json={
                        "session_id": session_id,
                        "event_id": event.get("event_id"),
                        "period": event.get("period"),
                        "game_clock": event.get("clock"),
                        "event_type": event.get("event_type"),
                        "player_name": event.get("player_name"),
                        "team_name": event.get("team_name"),
                        "score": event.get("score"),
                        "caption_text": event.get("text"),
                        "source": event.get("source"),
                        "confidence": event.get("confidence"),
                        "latency_ms": event.get("latency_ms"),
                        "model_name": event.get("model_name"),
                        "feed_description": event.get("feed_description"),
                        "visual_summary": event.get("visual_summary"),
                        "feed_context_json": event.get("feed_context"),
                    },
                )
            elif event_type in {"status", "complete", "stopped", "error"}:
                status = event.get("status") or event_type
                payload: dict[str, Any] = {"status": status}
                if event_type in {"complete", "stopped", "error"}:
                    payload["ended_at"] = datetime.now(timezone.utc).isoformat()
                await client.patch(
                    f"{base}/rest/v1/live_sessions",
                    params={"id": f"eq.{session_id}"},
                    headers=headers,
                    json=payload,
                )
    except Exception as e:
        logger.warning("Live Supabase persist failed: %s", e)


live_sessions = LiveSessionManager(event_sink=persist_live_event_to_supabase)


async def run_analyze(clip_id: str, file_url: str, commentary_temp: float) -> AnalysisResult:
    path = await download_video(file_url)
    try:
        frames = extract_frames(path, n=int(os.getenv("FRAME_SAMPLE_COUNT", "16")))
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    if os.getenv("OPENAI_API_KEY"):
        structured = await vision_with_openai(frames)
        vision_model = os.getenv("OPENAI_VISION_MODEL", "gpt-4o-mini")
    else:
        structured = vision_fallback()
        vision_model = "fallback-vision"

    segments: list[dict[str, Any]] = structured.get("segments") or []
    if os.getenv("OPENAI_API_KEY"):
        segment_lines = await commentary_lines_for_timeline(segments, temperature=commentary_temp)
        text = " ".join(segment_lines)
        text_model = os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini")
        model_name = f"{vision_model}+timeline+{text_model}"
    else:
        segment_lines = template_lines_for_timeline(segments)
        text = " ".join(segment_lines)
        model_name = f"{vision_model}+timeline-template"

    structured["visual_summary"] = await visual_summary_from_timeline(
        segments,
        segment_lines,
        str(structured.get("visual_summary", "")),
    )

    retrieved = retrieve_context(structured["player_name"], structured["team_name"])
    retrieved_ctx = {
        "player_stats": retrieved["player_stats"] or None,
        "team_stats": retrieved["team_stats"] or None,
    }
    # Normalize for JSON (omit empty dicts)
    if not retrieved_ctx["player_stats"]:
        retrieved_ctx["player_stats"] = None
    if not retrieved_ctx["team_stats"]:
        retrieved_ctx["team_stats"] = None

    return AnalysisResult(
        event_type=structured["event_type"],
        player_name=structured["player_name"],
        team_name=structured["team_name"],
        confidence=max(0.0, min(1.0, structured["confidence"])),
        visual_summary=structured["visual_summary"],
        retrieved_context=retrieved_ctx if (retrieved_ctx["player_stats"] or retrieved_ctx["team_stats"]) else None,
        commentary_text=text,
        model_name=model_name,
        possession_timeline=segments,
        segment_commentary_lines=segment_lines,
    )


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/live/uploads", response_model=LiveUploadResponse)
async def upload_live_replay(request: Request, filename: str = "replay.mp4") -> LiveUploadResponse:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".mp4", ".mov", ".m4v", ".webm"}:
        suffix = ".mp4"
    upload_id = uuid.uuid4().hex
    upload_dir = Path(tempfile.gettempdir()) / "vision2voice-live-uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    out_path = upload_dir / f"{upload_id}{suffix}"
    size = 0
    try:
        with out_path.open("wb") as out:
            async for chunk in request.stream():
                size += len(chunk)
                out.write(chunk)
    except Exception:
        try:
            out_path.unlink()
        except OSError:
            pass
        raise
    if size == 0:
        try:
            out_path.unlink()
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="Uploaded replay file is empty.")
    return LiveUploadResponse(
        upload_id=upload_id,
        file_url=str(request.url_for("get_live_replay_upload", upload_id=upload_id)),
        filename=filename,
        size_bytes=size,
    )


@app.get("/live/uploads/{upload_id}")
async def get_live_replay_upload(upload_id: str) -> FileResponse:
    if not re.fullmatch(r"[a-f0-9]{32}", upload_id):
        raise HTTPException(status_code=404, detail="Upload not found")
    upload_dir = Path(tempfile.gettempdir()) / "vision2voice-live-uploads"
    matches = list(upload_dir.glob(f"{upload_id}.*"))
    if not matches:
        raise HTTPException(status_code=404, detail="Upload not found")
    return FileResponse(matches[0], media_type="video/mp4", filename=matches[0].name)


@app.get("/live/teams", response_model=list[LiveTeamOptionResponse])
async def live_teams() -> list[LiveTeamOptionResponse]:
    return [LiveTeamOptionResponse(**asdict(team)) for team in nba_team_options()]


@app.get("/live/games/search", response_model=list[LiveGameSearchResultResponse])
async def search_live_games(
    team: str,
    opponent: str,
    season: str,
    season_type: str = "Regular Season",
    limit: int = 20,
) -> list[LiveGameSearchResultResponse]:
    try:
        capped_limit = max(1, min(limit, 50))
        results = await asyncio.to_thread(
            search_nba_games,
            team=team,
            opponent=opponent,
            season=season,
            season_type=season_type,
            limit=capped_limit,
        )
        return [LiveGameSearchResultResponse(**asdict(result)) for result in results]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Live game search failed")
        raise HTTPException(status_code=502, detail=f"NBA game search failed: {exc}") from exc


@app.post("/live/sessions", response_model=LiveSessionResponse)
async def create_live_session(body: LiveSessionRequest) -> LiveSessionResponse:
    try:
        session = await live_sessions.create_session(
            LiveSessionConfig(
                file_url=body.file_url,
                nba_game_id=body.nba_game_id,
                start_period=body.start_period,
                start_clock=body.start_clock,
                cadence_sec=body.cadence_sec,
                window_sec=body.window_sec,
                replay_speed=body.replay_speed,
                clock_mode=body.clock_mode,
            )
        )
        return LiveSessionResponse(
            session_id=session.session_id,
            status=session.status,
            team_names=session.kb.team_names,
            event_count=len(session.events),
            warnings=session.kb.warnings,
        )
    except Exception as e:
        logger.exception("Live session creation failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.get("/live/sessions/{session_id}/events")
async def live_session_events(session_id: str) -> StreamingResponse:
    if not live_sessions.get_session(session_id):
        raise HTTPException(status_code=404, detail="Live session not found")
    return StreamingResponse(
        live_sessions.event_stream(session_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/live/sessions/{session_id}/playback")
async def control_live_session_playback(
    session_id: str,
    body: LivePlaybackControlRequest,
) -> dict[str, str]:
    updated = await live_sessions.control_playback(
        session_id,
        state=body.state,
        replay_time_sec=body.replay_time_sec,
        playback_rate=body.playback_rate,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Live session not found")
    return {"status": body.state}


@app.post("/live/sessions/{session_id}/stop")
async def stop_live_session(session_id: str) -> dict[str, str]:
    stopped = await live_sessions.stop_session(session_id)
    if not stopped:
        raise HTTPException(status_code=404, detail="Live session not found")
    return {"status": "stopping"}


@app.post("/export-commentary-video")
async def export_commentary_video(body: VoiceoverExportBody) -> FileResponse:
    """TTS (OpenAI) + FFmpeg: one MP4 with AI voiceover replacing the clip audio."""
    if not os.getenv("OPENAI_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is required to synthesize voiceover audio.",
        )
    try:
        tl = body.possession_timeline
        sl = body.segment_commentary_lines
        if (
            tl
            and sl
            and len(tl) == len(sl)
            and len(tl) > 0
        ):
            out_path = await build_voiceover_timeline_mp4(body.file_url, tl, sl)
        else:
            out_path = await build_voiceover_mp4(
                body.file_url, (body.commentary_text or "").strip() or "No commentary."
            )
    except Exception as e:
        logger.exception("Voiceover export failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    return FileResponse(
        out_path,
        media_type="video/mp4",
        filename="vision2voice-voiceover.mp4",
        background=BackgroundTask(_unlink_temp, out_path),
    )


@app.post("/analyze", response_model=AnalysisResult)
async def analyze(body: ClipRequest) -> AnalysisResult:
    try:
        result = await run_analyze(body.clip_id, body.file_url, commentary_temp=0.75)
        await persist_to_supabase(body.clip_id, result, commentary_only=False)
        return result
    except httpx.HTTPStatusError as e:
        logger.exception("Download failed")
        raise HTTPException(status_code=502, detail=f"Video download failed: {e}") from e
    except Exception as e:
        logger.exception("Analyze failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/regenerate", response_model=AnalysisResult)
async def regenerate(body: ClipRequest) -> AnalysisResult:
    det = await supabase_get_latest("detections", body.clip_id)
    ctx_row = await supabase_get_latest("retrieved_context", body.clip_id)
    structured = row_to_structured(det)

    if structured and structured.get("visual_summary"):
        retrieved = row_to_retrieved(ctx_row)
        if not retrieved["player_stats"] and not retrieved["team_stats"]:
            retrieved = retrieve_context(structured["player_name"], structured["team_name"])
        if os.getenv("OPENAI_API_KEY"):
            text = await commentary_with_openai(structured, retrieved, temperature=0.95)
            model_name = f"{os.getenv('OPENAI_TEXT_MODEL', 'gpt-4o-mini')}-regen"
        else:
            text = commentary_template(structured, retrieved)
            model_name = "template-regen"
        rc = {
            "player_stats": retrieved["player_stats"] or None,
            "team_stats": retrieved["team_stats"] or None,
        }
        if not rc["player_stats"]:
            rc["player_stats"] = None
        if not rc["team_stats"]:
            rc["team_stats"] = None
        result = AnalysisResult(
            event_type=structured["event_type"],
            player_name=structured["player_name"],
            team_name=structured["team_name"],
            confidence=structured["confidence"],
            visual_summary=structured["visual_summary"],
            retrieved_context=rc if (rc["player_stats"] or rc["team_stats"]) else None,
            commentary_text=text,
            model_name=model_name,
            possession_timeline=[],
            segment_commentary_lines=[],
        )
        await persist_to_supabase(body.clip_id, result, commentary_only=True)
        return result

    result = await run_analyze(body.clip_id, body.file_url, commentary_temp=0.95)
    await persist_to_supabase(body.clip_id, result, commentary_only=False)
    return result
