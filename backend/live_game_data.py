"""Structured game data adapters for the live commentary pipeline."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Protocol

logger = logging.getLogger("vision2voice.live.game_data")

REGULATION_PERIOD_SEC = 12 * 60
OVERTIME_PERIOD_SEC = 5 * 60


@dataclass(slots=True)
class LivePlayer:
    player_id: str
    name: str
    team_id: str | None = None
    team_name: str | None = None
    jersey: str | None = None
    position: str | None = None


@dataclass(slots=True)
class LiveTeam:
    team_id: str
    name: str
    abbreviation: str | None = None
    city: str | None = None


@dataclass(slots=True)
class LiveGameEvent:
    event_id: str
    period: int
    clock: str
    game_elapsed_sec: float
    event_type: str
    description: str
    player_name: str | None = None
    team_id: str | None = None
    team_name: str | None = None
    score: str | None = None


@dataclass(slots=True)
class LiveGamePackage:
    game_id: str
    teams: list[LiveTeam] = field(default_factory=list)
    players: list[LivePlayer] = field(default_factory=list)
    events: list[LiveGameEvent] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class LiveGameSearchResult:
    game_id: str
    game_date: str
    season: str
    season_type: str
    matchup: str
    team_abbreviation: str
    opponent_abbreviation: str
    home_team: str | None
    away_team: str | None
    team_score: int | None
    opponent_score: int | None
    score: str | None
    result: str | None


class GameDataProvider(Protocol):
    def load_game(self, game_id: str) -> LiveGamePackage:
        ...


def parse_clock_to_remaining_sec(clock: str) -> float:
    """Parse NBA clock strings like '10:42', 'PT10M42.00S', or '42.1'."""
    raw = (clock or "").strip()
    if not raw:
        return 0.0
    iso = re.match(r"PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", raw, re.IGNORECASE)
    if iso:
        mins = float(iso.group(1) or 0)
        secs = float(iso.group(2) or 0)
        return mins * 60 + secs
    if ":" in raw:
        left, right = raw.split(":", 1)
        try:
            return max(0.0, float(left) * 60 + float(right))
        except ValueError:
            return 0.0
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 0.0


def period_length_sec(period: int) -> int:
    return REGULATION_PERIOD_SEC if period <= 4 else OVERTIME_PERIOD_SEC


def elapsed_before_period(period: int) -> int:
    if period <= 1:
        return 0
    regulation_done = min(period - 1, 4) * REGULATION_PERIOD_SEC
    ot_done = max(0, period - 5) * OVERTIME_PERIOD_SEC
    return regulation_done + ot_done


def game_elapsed_sec(period: int, clock: str) -> float:
    remaining = parse_clock_to_remaining_sec(clock)
    return elapsed_before_period(period) + max(0.0, period_length_sec(period) - remaining)


def clock_from_elapsed(period: int, elapsed_into_period: float) -> str:
    remaining = max(0.0, period_length_sec(period) - elapsed_into_period)
    mins = int(remaining // 60)
    secs = remaining - mins * 60
    if secs.is_integer():
        return f"{mins}:{int(secs):02d}"
    return f"{mins}:{secs:04.1f}"


def align_replay_time(
    start_period: int,
    start_clock: str,
    replay_elapsed_sec: float,
) -> tuple[int, str, float]:
    """Map replay elapsed seconds to NBA period/clock/game-elapsed seconds."""
    start_abs = game_elapsed_sec(start_period, start_clock)
    target_abs = max(0.0, start_abs + replay_elapsed_sec)
    period = 1
    while True:
        start_of_period = elapsed_before_period(period)
        end_of_period = start_of_period + period_length_sec(period)
        if target_abs <= end_of_period or period >= 10:
            return period, clock_from_elapsed(period, target_abs - start_of_period), target_abs
        period += 1


def _event_type_from_msg_type(msg_type: int | str | None, description: str) -> str:
    try:
        value = int(msg_type or 0)
    except (TypeError, ValueError):
        value = 0
    if value == 1:
        return "made_shot"
    if value == 2:
        return "missed_shot"
    if value == 3:
        return "free_throw"
    if value == 4:
        return "rebound"
    if value == 5:
        return "turnover"
    if value == 6:
        return "foul"
    if value == 8:
        return "substitution"
    if value == 9:
        return "timeout"
    d = description.lower()
    if "steal" in d:
        return "steal"
    if "block" in d:
        return "block"
    if "assist" in d:
        return "assist"
    return "game_event"


def _event_type_from_action(action_type: str, sub_type: str, description: str) -> str:
    blob = f"{action_type} {sub_type} {description}".lower()
    if "miss" in blob:
        return "missed_shot"
    if "made" in blob or "make" in blob:
        return "made_shot"
    if "free throw" in blob:
        return "free_throw"
    if "rebound" in blob:
        return "rebound"
    if "turnover" in blob:
        return "turnover"
    if "foul" in blob:
        return "foul"
    if "steal" in blob:
        return "steal"
    if "block" in blob:
        return "block"
    if "substitution" in blob or "sub:" in blob:
        return "substitution"
    if "timeout" in blob:
        return "timeout"
    if "period" in blob:
        return "period"
    return "game_event"


def _display_clock(clock: str) -> str:
    raw = (clock or "").strip()
    if not raw.upper().startswith("PT"):
        return raw
    remaining = parse_clock_to_remaining_sec(raw)
    mins = int(remaining // 60)
    secs = remaining - mins * 60
    if secs.is_integer():
        return f"{mins}:{int(secs):02d}"
    return f"{mins}:{secs:04.1f}"


def _score_from_v3(row: Any) -> str | None:
    home = str(row.get("scoreHome") or "").strip()
    away = str(row.get("scoreAway") or "").strip()
    if home and away:
        return f"{away}-{home}"
    return None


def nba_team_options() -> list[LiveTeam]:
    from nba_api.stats.static import teams as nba_teams

    return [
        LiveTeam(
            team_id=str(team["id"]),
            name=str(team["full_name"]),
            abbreviation=str(team["abbreviation"]),
            city=str(team["city"]),
        )
        for team in nba_teams.get_teams()
    ]


def resolve_nba_team(query: str) -> LiveTeam | None:
    needle = normalize_team_query(query)
    if not needle:
        return None
    for team in nba_team_options():
        candidates = {
            normalize_team_query(team.team_id),
            normalize_team_query(team.name),
            normalize_team_query(team.abbreviation or ""),
            normalize_team_query(team.city or ""),
            normalize_team_query((team.name or "").split()[-1]),
        }
        if needle in candidates:
            return team
    for team in nba_team_options():
        haystack = normalize_team_query(" ".join([team.name, team.abbreviation or "", team.city or ""]))
        if needle in haystack:
            return team
    return None


def normalize_team_query(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").lower())


def search_nba_games(
    *,
    team: str,
    opponent: str,
    season: str,
    season_type: str,
    limit: int = 20,
) -> list[LiveGameSearchResult]:
    team_info = resolve_nba_team(team)
    opponent_info = resolve_nba_team(opponent)
    if not team_info:
        raise ValueError(f"Unknown NBA team: {team}")
    if not opponent_info:
        raise ValueError(f"Unknown NBA team: {opponent}")
    if team_info.team_id == opponent_info.team_id:
        raise ValueError("Choose two different NBA teams.")
    if not re.fullmatch(r"\d{4}-\d{2}", season):
        raise ValueError("Season must use NBA format like 2023-24.")
    if season_type not in {"Regular Season", "Playoffs"}:
        raise ValueError("Season type must be Regular Season or Playoffs.")

    from nba_api.stats.endpoints import leaguegamefinder

    finder = leaguegamefinder.LeagueGameFinder(
        player_or_team_abbreviation="T",
        team_id_nullable=team_info.team_id,
        vs_team_id_nullable=opponent_info.team_id,
        season_nullable=season,
        season_type_nullable=season_type,
        timeout=30,
    )
    df = finder.get_data_frames()[0]
    results: list[LiveGameSearchResult] = []
    seen: set[str] = set()
    for _, row in df.sort_values("GAME_DATE", ascending=False).iterrows():
        game_id = str(row.get("GAME_ID") or "").strip()
        if not game_id or game_id in seen:
            continue
        seen.add(game_id)
        matchup = str(row.get("MATCHUP") or "").strip()
        team_abbr = str(row.get("TEAM_ABBREVIATION") or team_info.abbreviation or "").strip()
        opponent_abbr = opponent_info.abbreviation or ""
        home_abbr, away_abbr = matchup_home_away(matchup, team_abbr, opponent_abbr)
        team_score = int(row["PTS"]) if row.get("PTS") == row.get("PTS") else None
        plus_minus = row.get("PLUS_MINUS")
        opponent_score = None
        if team_score is not None and plus_minus == plus_minus:
            opponent_score = int(team_score - float(plus_minus))
        score = None
        if team_score is not None and opponent_score is not None:
            score = f"{team_score}-{opponent_score}"
        results.append(
            LiveGameSearchResult(
                game_id=game_id,
                game_date=str(row.get("GAME_DATE") or "").strip(),
                season=season,
                season_type=season_type,
                matchup=matchup,
                team_abbreviation=team_abbr,
                opponent_abbreviation=opponent_abbr,
                home_team=home_abbr,
                away_team=away_abbr,
                team_score=team_score,
                opponent_score=opponent_score,
                score=score,
                result=str(row.get("WL") or "").strip() or None,
            )
        )
        if len(results) >= limit:
            break
    return results


def matchup_home_away(matchup: str, team_abbr: str, opponent_abbr: str) -> tuple[str | None, str | None]:
    if " vs. " in matchup:
        return team_abbr, opponent_abbr
    if " @ " in matchup:
        return opponent_abbr, team_abbr
    return None, None


class NBAApiGameDataProvider:
    """First provider implementation backed by nba_api / stats.nba.com."""

    def load_game(self, game_id: str) -> LiveGamePackage:
        v3_package = self._load_game_v3(game_id)
        if v3_package.events:
            return v3_package
        if v3_package.warnings:
            logger.warning("Falling back to PlayByPlayV2 after V3 warning: %s", v3_package.warnings[-1])

        return self._load_game_v2(game_id, seed_warnings=v3_package.warnings)

    def _load_game_v3(self, game_id: str) -> LiveGamePackage:
        warnings: list[str] = []
        teams: dict[str, LiveTeam] = {}
        players: dict[str, LivePlayer] = {}
        events: list[LiveGameEvent] = []

        try:
            from nba_api.stats.endpoints import playbyplayv3
            from nba_api.stats.static import teams as nba_teams

            team_by_id = {str(t["id"]): t for t in nba_teams.get_teams()}
            pbp = playbyplayv3.PlayByPlayV3(game_id=game_id)
            df = pbp.get_data_frames()[0]
        except Exception as exc:  # pragma: no cover - network/provider dependent
            msg = f"nba_api play-by-play v3 unavailable for game {game_id}: {exc}"
            logger.warning(msg)
            return LiveGamePackage(game_id=game_id, warnings=[msg])

        for _, row in df.iterrows():
            description = str(row.get("description") or "").strip()
            if not description:
                continue
            period = int(row.get("period") or 1)
            clock = str(row.get("clock") or "PT00M00.00S")
            team_id = row.get("teamId")
            team_id_s = str(int(team_id)) if team_id == team_id and team_id not in (None, "", 0) else None
            team_name = None
            if team_id_s:
                tinfo = team_by_id.get(team_id_s, {})
                team_name = str(tinfo.get("full_name") or row.get("teamTricode") or team_id_s)
                teams.setdefault(
                    team_id_s,
                    LiveTeam(
                        team_id=team_id_s,
                        name=team_name,
                        abbreviation=str(row.get("teamTricode") or tinfo.get("abbreviation") or "").strip() or None,
                        city=str(tinfo.get("city") or "").strip() or None,
                    ),
                )

            person_id = row.get("personId")
            player_name = str(row.get("playerName") or "").strip() or None
            if player_name and person_id == person_id and person_id not in (None, "", 0):
                pid = str(int(person_id))
                players.setdefault(pid, LivePlayer(player_id=pid, name=player_name, team_id=team_id_s, team_name=team_name))

            action_type = str(row.get("actionType") or "")
            sub_type = str(row.get("subType") or "")
            events.append(
                LiveGameEvent(
                    event_id=str(row.get("actionNumber") or row.get("actionId") or f"{period}-{clock}-{len(events)}"),
                    period=period,
                    clock=_display_clock(clock),
                    game_elapsed_sec=game_elapsed_sec(period, clock),
                    event_type=_event_type_from_action(action_type, sub_type, description),
                    description=description,
                    player_name=player_name,
                    team_id=team_id_s,
                    team_name=team_name,
                    score=_score_from_v3(row),
                )
            )

        roster_players, roster_warnings = self._load_rosters(list(teams.values()))
        warnings.extend(roster_warnings)
        for p in roster_players:
            players.setdefault(p.player_id, p)

        events.sort(key=lambda e: (e.game_elapsed_sec, e.event_id))
        return LiveGamePackage(
            game_id=game_id,
            teams=list(teams.values()),
            players=list(players.values()),
            events=events,
            warnings=warnings,
        )

    def _load_game_v2(self, game_id: str, seed_warnings: list[str] | None = None) -> LiveGamePackage:
        warnings: list[str] = []
        if seed_warnings:
            warnings.extend(seed_warnings)
        teams: dict[str, LiveTeam] = {}
        players: dict[str, LivePlayer] = {}
        events: list[LiveGameEvent] = []

        try:
            from nba_api.stats.endpoints import playbyplayv2

            pbp = playbyplayv2.PlayByPlayV2(game_id=game_id)
            df = pbp.get_data_frames()[0]
        except Exception as exc:  # pragma: no cover - network/provider dependent
            msg = f"nba_api play-by-play unavailable for game {game_id}: {exc}"
            logger.warning(msg)
            warnings.append(msg)
            return LiveGamePackage(game_id=game_id, warnings=warnings)

        for _, row in df.iterrows():
            period = int(row.get("PERIOD") or 1)
            clock = str(row.get("PCTIMESTRING") or "0:00")
            description = (
                str(row.get("HOMEDESCRIPTION") or "")
                or str(row.get("VISITORDESCRIPTION") or "")
                or str(row.get("NEUTRALDESCRIPTION") or "")
            ).strip()
            if not description:
                continue
            team_id = row.get("PLAYER1_TEAM_ID")
            team_id_s = str(int(team_id)) if team_id == team_id and team_id not in (None, "") else None
            team_name = None
            if team_id_s:
                city = str(row.get("PLAYER1_TEAM_CITY") or "").strip()
                nick = str(row.get("PLAYER1_TEAM_NICKNAME") or "").strip()
                abbr = str(row.get("PLAYER1_TEAM_ABBREVIATION") or "").strip()
                team_name = " ".join(x for x in [city, nick] if x).strip() or abbr or None
                teams.setdefault(
                    team_id_s,
                    LiveTeam(team_id=team_id_s, name=team_name or team_id_s, abbreviation=abbr or None, city=city or None),
                )

            player_id = row.get("PLAYER1_ID")
            player_name = str(row.get("PLAYER1_NAME") or "").strip() or None
            if player_name and player_id == player_id and player_id not in (None, ""):
                pid = str(int(player_id))
                players.setdefault(pid, LivePlayer(player_id=pid, name=player_name, team_id=team_id_s, team_name=team_name))

            event_id = str(row.get("EVENTNUM") or f"{period}-{clock}-{len(events)}")
            events.append(
                LiveGameEvent(
                    event_id=event_id,
                    period=period,
                    clock=clock,
                    game_elapsed_sec=game_elapsed_sec(period, clock),
                    event_type=_event_type_from_msg_type(row.get("EVENTMSGTYPE"), description),
                    description=description,
                    player_name=player_name,
                    team_id=team_id_s,
                    team_name=team_name,
                    score=str(row.get("SCORE") or "").strip() or None,
                )
            )

        roster_players, roster_warnings = self._load_rosters(list(teams.values()))
        warnings.extend(roster_warnings)
        for p in roster_players:
            players.setdefault(p.player_id, p)

        events.sort(key=lambda e: (e.game_elapsed_sec, e.event_id))
        return LiveGamePackage(
            game_id=game_id,
            teams=list(teams.values()),
            players=list(players.values()),
            events=events,
            warnings=warnings,
        )

    def _load_rosters(self, teams: list[LiveTeam]) -> tuple[list[LivePlayer], list[str]]:
        out: list[LivePlayer] = []
        warnings: list[str] = []
        try:
            from nba_api.stats.endpoints import commonteamroster
        except Exception as exc:  # pragma: no cover - import/environment dependent
            return [], [f"nba_api roster endpoint unavailable: {exc}"]

        for team in teams:
            try:
                roster = commonteamroster.CommonTeamRoster(team_id=int(team.team_id))
                df = roster.get_data_frames()[0]
                for _, row in df.iterrows():
                    player_id = row.get("PLAYER_ID")
                    name = str(row.get("PLAYER") or "").strip()
                    if not name or player_id != player_id:
                        continue
                    out.append(
                        LivePlayer(
                            player_id=str(int(player_id)),
                            name=name,
                            team_id=team.team_id,
                            team_name=team.name,
                            jersey=str(row.get("NUM") or "").strip() or None,
                            position=str(row.get("POSITION") or "").strip() or None,
                        )
                    )
            except Exception as exc:  # pragma: no cover - network/provider dependent
                warnings.append(f"Roster unavailable for {team.name}: {exc}")
        return out, warnings


class StaticGameDataProvider:
    """Deterministic provider for tests and local fixtures."""

    def __init__(self, package: LiveGamePackage):
        self.package = package

    def load_game(self, game_id: str) -> LiveGamePackage:
        return self.package
