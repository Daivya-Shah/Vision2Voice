"""
Map jersey numbers + team hints to NBA player names using nba_api (stats.nba.com data).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any

logger = logging.getLogger("vision2voice.jersey")

_ROSTER_CACHE: dict[int, list[tuple[str, str]]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL_SEC = 45 * 60
_CACHE_TIME: dict[int, float] = {}


def _jersey_key(num: str) -> str:
    s = str(num).strip()
    if not s:
        return ""
    if s.isdigit():
        if s == "00":
            return "00"
        return str(int(s))
    return s


def _jersey_match(roster_num: str, target: str) -> bool:
    return _jersey_key(roster_num) == _jersey_key(target)


def _fetch_roster(team_id: int) -> list[tuple[str, str]]:
    from nba_api.stats.endpoints import commonteamroster

    r = commonteamroster.CommonTeamRoster(team_id=team_id)
    df = r.get_data_frames()[0]
    out: list[tuple[str, str]] = []
    for _, row in df.iterrows():
        name = str(row.get("PLAYER", "")).strip()
        num = str(row.get("NUM", "")).strip()
        if name and num and num != "None":
            out.append((name, num))
    return out


def get_roster(team_id: int) -> list[tuple[str, str]]:
    now = time.monotonic()
    with _CACHE_LOCK:
        ts = _CACHE_TIME.get(team_id, 0)
        if team_id in _ROSTER_CACHE and (now - ts) < _CACHE_TTL_SEC:
            return _ROSTER_CACHE[team_id]
    roster = _fetch_roster(team_id)
    with _CACHE_LOCK:
        _ROSTER_CACHE[team_id] = roster
        _CACHE_TIME[team_id] = time.monotonic()
    return roster


def _nba_team_list() -> list[dict[str, Any]]:
    from nba_api.stats.static import teams as nba_teams

    return nba_teams.get_teams()


def _score_team_hint(blob: str, t: dict[str, Any]) -> int:
    """
    Higher = stronger match. Penalize bare city-only hints (e.g. 'Los Angeles' matching
    both Lakers and Clippers — was picking the wrong roster first).
    """
    b = blob.lower().strip()
    if len(b) < 2:
        return 0
    full = (t.get("full_name") or "").lower()
    nick = (t.get("nickname") or "").lower()
    city = (t.get("city") or "").lower()
    abbr = (t.get("abbreviation") or "").lower()
    if b == abbr:
        return 100
    if nick and (b == nick or nick in b or b in nick):
        return 92
    if nick and nick in b:
        return 88
    if b in full and nick and nick in b:
        return 86
    if b in full and len(b) >= 14:
        return 78
    if full in b and len(full) >= 10:
        return 76
    if b in full or full in b:
        return 58
    if city in b or b in city:
        if city == "los angeles" and b.strip() in ("los angeles", "la", "l.a.", "l a"):
            return 8
        return 22
    return 0


def team_ids_from_hints(*hints: str) -> list[int]:
    """Fuzzy match vision strings to NBA team ids; best matches first."""
    blobs = [h.lower().strip() for h in hints if h and str(h).strip().lower() not in ("", "unknown")]
    if not blobs:
        return []
    min_score = int(os.getenv("NBA_TEAM_HINT_MIN_SCORE", "35"))
    scored: list[tuple[int, int]] = []
    seen: set[int] = set()
    for t in _nba_team_list():
        tid = int(t["id"])
        if tid in seen:
            continue
        best = 0
        for blob in blobs:
            best = max(best, _score_team_hint(blob, t))
        if best >= min_score:
            seen.add(tid)
            scored.append((best, tid))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [tid for _, tid in scored[:8]]


def resolve_player_from_roster(jersey: str, team_id: int) -> str | None:
    j = _jersey_key(jersey)
    if not j:
        return None
    for name, num in get_roster(team_id):
        if _jersey_match(num, j):
            return name
    return None


def _vision_named_player_specific(name: str) -> bool:
    """True when vision gave a probable full name (not 'Unknown' / one token)."""
    n = (name or "").strip()
    if not n or n.lower() == "unknown":
        return False
    parts = [p for p in n.replace(".", " ").split() if len(p) >= 2]
    return len(parts) >= 2


def _normalize_person_name(name: str) -> str:
    return " ".join((name or "").lower().split())


def _hint_aligns_with_resolved_team(hints: list[str], nba_full_name: str) -> bool:
    """True if any non-unknown hint is consistent with the NBA full team name."""
    nf = (nba_full_name or "").lower().strip()
    if not nf:
        return False
    for raw in hints:
        h = raw.lower().strip()
        if len(h) < 3 or h == "unknown":
            continue
        if h in nf or nf in h:
            return True
        if "laker" in h and "laker" in nf:
            return True
        if "clip" in h and "clip" in nf:
            return True
        for tok in nf.split():
            if len(tok) >= 4 and tok in h:
                return True
    return False


def enrich_vision_with_nba_rosters(
    vision: dict[str, Any],
    *,
    append_match_note: bool = True,
) -> dict[str, Any]:
    """
    If vision extracted jersey # + team hints, resolve player via current NBA rosters.
    Mutates and returns the same dict (player_name / team_name upgraded when confident).
    """
    jersey = (
        vision.get("jersey_number_primary")
        or vision.get("primary_jersey_number")
        or (vision.get("jersey_numbers_visible") or [None])[0]
    )
    jersey = str(jersey).strip() if jersey is not None else ""
    if not jersey or jersey.lower() == "unknown":
        return vision

    team_hints = [
        str(vision.get("team_name", "") or ""),
        str(vision.get("team_name_from_visuals", "") or ""),
        str(vision.get("team_name_from_scoreboard", "") or ""),
    ]
    team_ids = team_ids_from_hints(*team_hints)

    resolved_player: str | None = None
    resolved_team_id: int | None = None

    for tid in team_ids:
        name = resolve_player_from_roster(jersey, tid)
        if name:
            resolved_player = name
            resolved_team_id = tid
            break

    if not resolved_player and team_ids:
        logger.debug("Jersey %s not on hinted team rosters: %s", jersey, team_ids)

    if resolved_player and resolved_team_id is not None:
        tinfo = next((t for t in _nba_team_list() if t["id"] == resolved_team_id), None)
        tname = (tinfo or {}).get("full_name") or "Unknown"
        old_p = str(vision.get("player_name", "")).strip()

        if any(str(h).strip() and str(h).strip().lower() != "unknown" for h in team_hints):
            if not _hint_aligns_with_resolved_team(team_hints, tname):
                logger.info(
                    "Skipping roster match: resolved team %r does not match hints %r",
                    tname,
                    team_hints,
                )
                return vision

        if _vision_named_player_specific(old_p):
            if _normalize_person_name(old_p) != _normalize_person_name(resolved_player):
                logger.info(
                    "Skipping roster match: keeping vision player %r over roster %r (#%s)",
                    old_p,
                    resolved_player,
                    jersey,
                )
                return vision

        vision["player_name"] = resolved_player
        vision["team_name"] = tname
        if append_match_note:
            note = (
                f" Roster match (jersey #{jersey}, NBA stats): {resolved_player} ({tname})."
                f" Prior model guess was: {old_p}."
            )
            vision["visual_summary"] = (vision.get("visual_summary") or "").strip() + note
        try:
            vision["confidence"] = min(0.98, float(vision.get("confidence", 0.6)) + 0.12)
        except (TypeError, ValueError):
            vision["confidence"] = 0.85
        logger.info("Resolved jersey #%s -> %s (%s)", jersey, resolved_player, tname)

    return vision


def enrich_timeline_segments(segments: list[dict[str, Any]]) -> None:
    """Resolve jersey # → player for each possession segment (no long summary spam)."""
    for seg in segments:
        work = {
            "player_name": str(seg.get("player_name", "Unknown")),
            "team_name": str(seg.get("team_name", "Unknown")),
            "jersey_number_primary": seg.get("jersey_number_primary") or seg.get("jersey_number"),
            "team_name_from_visuals": seg.get("team_name_from_visuals") or seg.get("team_name"),
            "team_name_from_scoreboard": seg.get("team_name_from_scoreboard"),
            "confidence": float(seg.get("confidence", 0.5) or 0.5),
            "visual_summary": "",
        }
        enrich_vision_with_nba_rosters(work, append_match_note=False)
        seg["player_name"] = work["player_name"]
        seg["team_name"] = work["team_name"]
