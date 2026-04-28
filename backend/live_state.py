"""State reconciliation and caption generation for live replay sessions."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any

from live_game_data import LiveGameEvent
from live_kb import PregameKnowledgeBase
from openai_retry import with_openai_retry


@dataclass(slots=True)
class VisualObservation:
    summary: str
    confidence: float
    changed: bool = False


@dataclass(slots=True)
class FeedContext:
    period: int
    clock: str
    team_names: list[str]
    nearest_prior: LiveGameEvent | None = None
    nearest_next: LiveGameEvent | None = None
    last_score: str | None = None

    def description(self) -> str:
        parts = [f"Q{self.period} {self.clock}"]
        if self.last_score:
            parts.append(f"score {self.last_score}")
        if self.nearest_prior:
            parts.append(f"previous: {self.nearest_prior.description}")
        if self.nearest_next:
            parts.append(f"next: {self.nearest_next.description}")
        return " | ".join(parts)


@dataclass(slots=True)
class CaptionDecision:
    event_id: str
    period: int
    clock: str
    event_type: str
    player_name: str | None
    team_name: str | None
    score: str | None
    text: str
    source: str
    confidence: float
    model_name: str
    replay_time_sec: float
    feed_description: str | None = None
    visual_summary: str | None = None
    feed_context: dict[str, Any] | None = None
    latency_ms: int = 0


@dataclass
class LiveStateReconciler:
    kb: PregameKnowledgeBase
    recent_captions: list[str] = field(default_factory=list)
    seen_event_ids: set[str] = field(default_factory=set)
    last_event_type: str | None = None
    last_possession_team: str | None = None

    def unseen_feed_events(self, events: list[LiveGameEvent]) -> list[LiveGameEvent]:
        out: list[LiveGameEvent] = []
        for event in events:
            if event.event_id in self.seen_event_ids:
                continue
            out.append(event)
        return out

    async def caption_for_feed_event(
        self,
        event: LiveGameEvent,
        *,
        replay_time_sec: float,
        visual: VisualObservation | None,
    ) -> CaptionDecision:
        self.seen_event_ids.add(event.event_id)
        if event.team_name:
            self.last_possession_team = event.team_name
        self.last_event_type = event.event_type
        text, model = await generate_caption_text(
            event=event,
            kb=self.kb,
            recent_captions=self.recent_captions,
            visual=visual,
        )
        self._remember(text)
        context = FeedContext(
            period=event.period,
            clock=event.clock,
            team_names=self.kb.team_names,
            nearest_prior=event,
            last_score=event.score,
        )
        return CaptionDecision(
            event_id=event.event_id,
            period=event.period,
            clock=event.clock,
            event_type=event.event_type,
            player_name=event.player_name,
            team_name=event.team_name,
            score=event.score,
            text=text,
            source="feed_with_vision" if visual else "feed",
            confidence=0.92 if visual else 0.88,
            model_name=model,
            replay_time_sec=replay_time_sec,
            feed_description=event.description,
            visual_summary=visual.summary if visual else None,
            feed_context=feed_context_to_payload(context),
        )

    async def caption_for_feed_context(
        self,
        *,
        period: int,
        clock: str,
        replay_time_sec: float,
        visual: VisualObservation | None,
        context: FeedContext,
    ) -> CaptionDecision | None:
        if not visual or not visual.changed:
            return None
        event_id = f"feed-context-{period}-{clock}-{int(replay_time_sec)}"
        if event_id in self.seen_event_ids:
            return None
        self.seen_event_ids.add(event_id)
        text, model = await generate_context_caption_text(
            context=context,
            kb=self.kb,
            recent_captions=self.recent_captions,
            visual=visual,
        )
        self._remember(text)
        return CaptionDecision(
            event_id=event_id,
            period=period,
            clock=clock,
            event_type="feed_context",
            player_name=None,
            team_name=self.last_possession_team or context_team_name(context),
            score=context.last_score,
            text=text,
            source="feed_context_with_vision",
            confidence=min(0.72, max(0.45, visual.confidence)),
            model_name=model,
            replay_time_sec=replay_time_sec,
            feed_description=context.description(),
            visual_summary=visual.summary,
            feed_context=feed_context_to_payload(context),
        )

    def _remember(self, text: str) -> None:
        self.recent_captions.append(text)
        del self.recent_captions[:-5]


async def generate_caption_text(
    *,
    event: LiveGameEvent,
    kb: PregameKnowledgeBase,
    recent_captions: list[str],
    visual: VisualObservation | None,
) -> tuple[str, str]:
    if not os.getenv("OPENAI_API_KEY"):
        return template_caption(event, kb, visual), "template-live"

    from openai import AsyncOpenAI

    facts = kb.facts_for(event.player_name, event.team_name)
    context = FeedContext(
        period=event.period,
        clock=event.clock,
        team_names=kb.team_names,
        nearest_prior=event,
        last_score=event.score,
    )
    payload: dict[str, Any] = {
        "event_type": event.event_type,
        "description": event.description,
        "player_name": event.player_name,
        "team_name": event.team_name,
        "period": event.period,
        "clock": event.clock,
        "score": event.score,
        "feed_context": feed_context_to_payload(context),
        "pregame_facts": facts,
        "recent_captions": recent_captions[-3:],
        "visual_evidence": visual.summary if visual else None,
    }
    prompt = (
        "Write exactly one concise live NBA caption, 10-22 words.\n"
        "Structured play-by-play is the source of truth. Do not invent stats, score, player names, or outcomes.\n"
        "Use one pregame fact only if it naturally fits. Avoid repeating recent captions.\n\n"
        f"Data:\n{json.dumps(payload, indent=2)}\n\n"
        "Return plain text only."
    )
    client = AsyncOpenAI()

    async def _call():
        return await client.chat.completions.create(
            model=os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.45,
            max_tokens=80,
        )

    resp = await with_openai_retry(_call, label="live_caption")
    text = (resp.choices[0].message.content or "").strip().strip('"')
    return text or template_caption(event, kb, visual), os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini")


async def generate_context_caption_text(
    *,
    context: FeedContext,
    kb: PregameKnowledgeBase,
    recent_captions: list[str],
    visual: VisualObservation,
) -> tuple[str, str]:
    payload: dict[str, Any] = {
        "feed_context": feed_context_to_payload(context),
        "pregame_facts": kb.facts_for(None, context_team_name(context)),
        "recent_captions": recent_captions[-3:],
        "visual_evidence": visual.summary,
    }
    if not os.getenv("OPENAI_API_KEY"):
        return template_context_caption(context, visual), "template-live-context"

    from openai import AsyncOpenAI

    prompt = (
        "Write exactly one concise live NBA caption, 10-22 words.\n"
        "Every caption must be grounded in feed_context. Use the current game clock, teams, or score when useful.\n"
        "This payload has no exact play-by-play event for the current video window.\n"
        "Do not state a specific player, scoring result, rebound, turnover, foul, assist, or made/missed shot "
        "unless it appears in an exact matched event. Here there is no exact matched event.\n"
        "You may describe the visual action cautiously and relate it to nearest prior/next feed context.\n"
        "Avoid starting with 'Visually,' unless there is no natural feed-aware wording.\n\n"
        f"Data:\n{json.dumps(payload, indent=2)}\n\n"
        "Return plain text only."
    )
    client = AsyncOpenAI()

    async def _call():
        return await client.chat.completions.create(
            model=os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            temperature=0.35,
            max_tokens=80,
        )

    resp = await with_openai_retry(_call, label="live_context_caption")
    text = (resp.choices[0].message.content or "").strip().strip('"')
    return text or template_context_caption(context, visual), os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini")


def template_caption(
    event: LiveGameEvent,
    kb: PregameKnowledgeBase,
    visual: VisualObservation | None,
) -> str:
    subject = event.player_name or event.team_name or "The offense"
    desc = event.description.rstrip(".")
    if event.event_type in {"made_shot", "missed_shot", "free_throw", "turnover", "rebound", "foul"}:
        base = f"{subject}: {desc}."
    else:
        base = f"{desc}."
    facts = kb.facts_for(event.player_name, event.team_name, limit=1)
    if facts and len(base.split()) < 17:
        base = f"{base} {facts[0]}"
    if visual and visual.summary and len(base.split()) < 18:
        base = f"{base} {visual.summary}"
    return " ".join(base.split()[:28])


def template_context_caption(context: FeedContext, visual: VisualObservation) -> str:
    teams = " vs. ".join(context.team_names[:2]) or "the teams"
    score = f" with the score at {context.last_score}" if context.last_score else ""
    summary = visual.summary.strip().rstrip(".") or "the possession develops"
    return f"At Q{context.period} {context.clock}{score}, {teams} reset as {summary}."


def context_team_name(context: FeedContext) -> str | None:
    if context.nearest_prior and context.nearest_prior.team_name:
        return context.nearest_prior.team_name
    if context.nearest_next and context.nearest_next.team_name:
        return context.nearest_next.team_name
    return context.team_names[0] if context.team_names else None


def feed_context_to_payload(context: FeedContext) -> dict[str, Any]:
    return {
        "period": context.period,
        "clock": context.clock,
        "teams": context.team_names,
        "last_score": context.last_score,
        "nearest_prior_event": event_to_payload(context.nearest_prior),
        "nearest_next_event": event_to_payload(context.nearest_next),
    }


def event_to_payload(event: LiveGameEvent | None) -> dict[str, Any] | None:
    if event is None:
        return None
    return {
        "event_id": event.event_id,
        "period": event.period,
        "clock": event.clock,
        "event_type": event.event_type,
        "description": event.description,
        "player_name": event.player_name,
        "team_name": event.team_name,
        "score": event.score,
    }
