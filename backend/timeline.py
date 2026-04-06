"""Possession timeline: normalize vision segments + per-segment commentary lines."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from openai_retry import with_openai_retry

logger = logging.getLogger("vision2voice.timeline")

_MIN_SEG = 0.04  # merge segments shorter than ~2–3 frames on a 5s clip


def normalize_timeline(
    segments: list[dict[str, Any]],
    fallback: dict[str, Any],
    valid_events: set[str],
) -> list[dict[str, Any]]:
    if not segments:
        return [
            {
                "t0": 0.0,
                "t1": 1.0,
                "event_type": fallback.get("event_type", "Other"),
                "player_name": str(fallback.get("player_name", "Unknown")),
                "team_name": str(fallback.get("team_name", "Unknown")),
                "jersey_number_primary": fallback.get("jersey_number_primary"),
                "team_name_from_visuals": fallback.get("team_name_from_visuals"),
                "team_name_from_scoreboard": fallback.get("team_name_from_scoreboard"),
            }
        ]

    out: list[dict[str, Any]] = []
    for s in segments:
        try:
            t0 = float(s.get("t0", 0))
            t1 = float(s.get("t1", 1))
        except (TypeError, ValueError):
            continue
        t0 = max(0.0, min(1.0, t0))
        t1 = max(0.0, min(1.0, t1))
        if t1 - t0 < 1e-6:
            continue
        et = str(s.get("event_type", "Other"))
        if et not in valid_events:
            et = "Other"
        out.append(
            {
                "t0": t0,
                "t1": t1,
                "event_type": et,
                "player_name": str(s.get("player_name", "Unknown")).strip() or "Unknown",
                "team_name": str(s.get("team_name", "Unknown")).strip() or "Unknown",
                "jersey_number_primary": s.get("jersey_number_primary"),
                "team_name_from_visuals": s.get("team_name_from_visuals"),
                "team_name_from_scoreboard": s.get("team_name_from_scoreboard"),
            }
        )

    out.sort(key=lambda x: x["t0"])
    merged: list[dict[str, Any]] = []
    for seg in out:
        if not merged:
            merged.append(seg)
            continue
        prev = merged[-1]
        if seg["t0"] < prev["t1"] - 1e-6:
            seg["t0"] = prev["t1"]
        if seg["t1"] - seg["t0"] < _MIN_SEG:
            prev["t1"] = max(prev["t1"], seg["t1"])
            continue
        if abs(seg["t0"] - prev["t1"]) < 0.02:
            seg["t0"] = prev["t1"]
        merged.append(seg)

    if not merged:
        return normalize_timeline([], fallback, valid_events)

    if merged[0]["t0"] > 0.02:
        merged.insert(
            0,
            {
                "t0": 0.0,
                "t1": merged[0]["t0"],
                "event_type": merged[0]["event_type"],
                "player_name": merged[0]["player_name"],
                "team_name": merged[0]["team_name"],
                "jersey_number_primary": merged[0].get("jersey_number_primary"),
                "team_name_from_visuals": merged[0].get("team_name_from_visuals"),
                "team_name_from_scoreboard": merged[0].get("team_name_from_scoreboard"),
            },
        )

    if merged[-1]["t1"] < 0.98:
        merged[-1]["t1"] = 1.0

    for i in range(len(merged) - 1):
        merged[i]["t1"] = merged[i + 1]["t0"]

    merged[-1]["t1"] = 1.0
    return merged


async def commentary_lines_for_timeline(
    segments: list[dict[str, Any]],
    *,
    temperature: float = 0.65,
) -> list[str]:
    from openai import AsyncOpenAI

    if not segments:
        return []
    slim = [
        {
            "t0": s["t0"],
            "t1": s["t1"],
            "event_type": s["event_type"],
            "player_name": s["player_name"],
            "team_name": s["team_name"],
        }
        for s in segments
    ]
    payload = json.dumps(slim, indent=2)
    n = len(segments)
    prompt = f"""You are an NBA TV play-by-play announcer. The clip is split into {n} time-ordered segments.
For EACH segment, write exactly ONE short sentence (max 22 words) for live commentary.
Rules:
- Always track the BALL: say who has possession for that slice of time.
- When the ball moves (pass, handoff, steal, rebound grab), name the NEW player and team clearly.
- Match the event_type for that segment (shot, pass, dribble, rebound, etc.).
- Do not repeat the same full sentence across segments unless nothing changed.

Segments (t0/t1 are 0–1 fractions of clip length):
{payload}

Reply with ONLY valid JSON: {{"lines": [<string>, ...]}} with exactly {n} strings in order."""

    client = AsyncOpenAI()

    async def _timeline_call():
        return await client.chat.completions.create(
            model=os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=float(temperature),
            max_tokens=800,
        )

    resp = await with_openai_retry(_timeline_call, label="timeline_commentary")
    raw = resp.choices[0].message.content or "{{}}"
    data = json.loads(raw)
    lines = data.get("lines") or []
    if not isinstance(lines, list):
        lines = []
    out = [str(x).strip() or "Action on the floor." for x in lines[:n]]
    while len(out) < n:
        out.append(f"{segments[len(out)]['player_name']} for {segments[len(out)]['team_name']}.")
    return out[:n]


def template_lines_for_timeline(segments: list[dict[str, Any]]) -> list[str]:
    return [
        f"{s['event_type']}: {s['player_name']} ({s['team_name']}) has the rock."
        for s in segments
    ]


def template_visual_summary_from_timeline(
    segments: list[dict[str, Any]],
    lines: list[str],
    prior_summary: str,
) -> str:
    """No-API fallback: tie summary text to the same beats as commentary."""
    joined = " ".join(lines).strip()
    if joined:
        return joined[:2000]
    if not segments:
        return (prior_summary or "").strip() or "No summary produced."
    flow = "; ".join(
        f"{s['player_name']} ({s['team_name']}) — {s['event_type']}" for s in segments
    )
    head = (prior_summary or "").strip()
    if head:
        return f"{head} Chronological flow: {flow}"[:2000]
    return flow


async def visual_summary_from_timeline(
    segments: list[dict[str, Any]],
    lines: list[str],
    prior_summary: str,
) -> str:
    """
    Rewrite visual_summary so it matches the possession timeline + commentary lines
    (vision alone often drifts from the text model's play-by-play).
    """
    if not segments:
        return (prior_summary or "").strip() or "No summary produced."
    if not os.getenv("OPENAI_API_KEY"):
        return template_visual_summary_from_timeline(segments, lines, prior_summary)

    from openai import AsyncOpenAI

    slim_segs = [
        {
            "t0": s["t0"],
            "t1": s["t1"],
            "event_type": s["event_type"],
            "player_name": s["player_name"],
            "team_name": s["team_name"],
        }
        for s in segments
    ]
    payload = json.dumps({"segments": slim_segs, "commentary_lines": lines}, indent=2)
    prompt = f"""An earlier vision pass wrote this visual_summary (it may not match the final play-by-play):
\"\"\"{(prior_summary or "").strip()}\"\"\"

AUTHORITATIVE data in time order (must match this, not contradict it):
{payload}

Write a replacement visual_summary of 2–4 sentences: factual, broadcast style, present tense for live action.
Rules:
- Describe the SAME chronological sequence as the segments and commentary_lines (who has the ball when, passes, shots, etc.).
- Do not assign the ball to a player if a segment gives it to someone else in that interval.
- If the old summary conflicts with the timeline, follow the timeline and lines.
- Plain prose only — no JSON, no bullet list."""

    client = AsyncOpenAI()

    async def _call():
        return await client.chat.completions.create(
            model=os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.35,
            max_tokens=280,
        )

    resp = await with_openai_retry(_call, label="visual_summary_align")
    out = (resp.choices[0].message.content or "").strip()
    return out or template_visual_summary_from_timeline(segments, lines, prior_summary)
