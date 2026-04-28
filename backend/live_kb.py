"""Pregame knowledge base for low-latency live captions."""

from __future__ import annotations

from dataclasses import dataclass, field

from live_game_data import LiveGamePackage


@dataclass(slots=True)
class PregameKnowledgeBase:
    game_id: str
    team_names: list[str] = field(default_factory=list)
    player_facts: dict[str, list[str]] = field(default_factory=dict)
    team_facts: dict[str, list[str]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def facts_for(self, player_name: str | None, team_name: str | None, limit: int = 2) -> list[str]:
        facts: list[str] = []
        if player_name:
            facts.extend(self.player_facts.get(player_name.lower(), []))
        if team_name:
            facts.extend(self.team_facts.get(team_name.lower(), []))
        return facts[:limit]


def build_pregame_kb(package: LiveGamePackage) -> PregameKnowledgeBase:
    kb = PregameKnowledgeBase(
        game_id=package.game_id,
        team_names=[t.name for t in package.teams],
        warnings=list(package.warnings),
    )

    for team in package.teams:
        facts = [f"{team.name} is one of the teams in this game."]
        if team.abbreviation:
            facts.append(f"Team abbreviation: {team.abbreviation}.")
        kb.team_facts[team.name.lower()] = facts

    for player in package.players:
        facts: list[str] = []
        if player.team_name:
            facts.append(f"{player.name} is on {player.team_name}.")
        if player.jersey:
            facts.append(f"{player.name} wears jersey #{player.jersey}.")
        if player.position:
            facts.append(f"{player.name} is listed at {player.position}.")
        if facts:
            kb.player_facts[player.name.lower()] = facts

    return kb
