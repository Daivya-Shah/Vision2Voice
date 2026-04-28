import asyncio
import os
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from live_game_data import (
    LiveGameEvent,
    LiveGamePackage,
    LivePlayer,
    LiveTeam,
    StaticGameDataProvider,
    align_replay_time,
    game_elapsed_sec,
)
from live_kb import build_pregame_kb
from live_sessions import LiveSessionConfig, LiveSessionManager
from live_state import FeedContext, LiveStateReconciler, VisualObservation


class LivePipelineUnitTests(unittest.IsolatedAsyncioTestCase):
    def test_align_replay_time_from_start_clock(self):
        period, clock, elapsed = align_replay_time(1, "12:00", 75)
        self.assertEqual(period, 1)
        self.assertEqual(clock, "10:45")
        self.assertEqual(elapsed, 75)

    def test_overtime_alignment(self):
        period, clock, _ = align_replay_time(4, "0:10", 20)
        self.assertEqual(period, 5)
        self.assertEqual(clock, "4:50")

    def test_pregame_kb_player_lookup(self):
        package = LiveGamePackage(
            game_id="fixture",
            teams=[LiveTeam(team_id="1", name="Boston Celtics", abbreviation="BOS")],
            players=[
                LivePlayer(
                    player_id="7",
                    name="Jaylen Brown",
                    team_id="1",
                    team_name="Boston Celtics",
                    jersey="7",
                    position="G-F",
                )
            ],
        )
        kb = build_pregame_kb(package)
        facts = kb.facts_for("Jaylen Brown", "Boston Celtics", limit=3)
        self.assertTrue(any("jersey #7" in fact for fact in facts))

    async def test_reconciler_suppresses_duplicate_feed_events(self):
        kb = build_pregame_kb(LiveGamePackage(game_id="fixture"))
        reconciler = LiveStateReconciler(kb)
        event = LiveGameEvent(
            event_id="1",
            period=1,
            clock="11:30",
            game_elapsed_sec=30,
            event_type="made_shot",
            description="Player makes 3PT jump shot",
            player_name="Player",
            team_name="Team",
        )
        self.assertEqual(reconciler.unseen_feed_events([event]), [event])
        await reconciler.caption_for_feed_event(event, replay_time_sec=30, visual=None)
        self.assertEqual(reconciler.unseen_feed_events([event]), [])

    async def test_context_caption_uses_feed_context_source(self):
        package = LiveGamePackage(
            game_id="fixture",
            teams=[LiveTeam(team_id="1", name="Test Team", abbreviation="TST")],
            events=[
                LiveGameEvent(
                    event_id="prior",
                    period=1,
                    clock="11:45",
                    game_elapsed_sec=15,
                    event_type="made_shot",
                    description="Test Player makes 2PT layup",
                    player_name="Test Player",
                    team_name="Test Team",
                    score="2-0",
                ),
                LiveGameEvent(
                    event_id="next",
                    period=1,
                    clock="11:30",
                    game_elapsed_sec=30,
                    event_type="rebound",
                    description="Opponent REBOUND",
                    team_name="Opponent",
                ),
            ],
        )
        kb = build_pregame_kb(package)
        reconciler = LiveStateReconciler(kb)
        decision = await reconciler.caption_for_feed_context(
            period=1,
            clock="11:36",
            replay_time_sec=24,
            visual=VisualObservation("players space the floor around the arc", 0.6, changed=True),
            context=FeedContext(
                period=1,
                clock="11:36",
                team_names=["Test Team", "Opponent"],
                nearest_prior=package.events[0],
                nearest_next=package.events[1],
                last_score="2-0",
            ),
        )
        self.assertIsNotNone(decision)
        self.assertEqual(decision.source, "feed_context_with_vision")
        self.assertNotEqual(decision.source, "vision_only")
        self.assertEqual(decision.score, "2-0")
        self.assertEqual(decision.feed_context["nearest_prior_event"]["event_id"], "prior")


class LivePipelineIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_session_stream_emits_caption_with_latency_metadata(self):
        package = LiveGamePackage(
            game_id="fixture",
            teams=[LiveTeam(team_id="1", name="Test Team", abbreviation="TST")],
            players=[LivePlayer(player_id="1", name="Test Player", team_id="1", team_name="Test Team")],
            events=[
                LiveGameEvent(
                    event_id="evt-1",
                    period=1,
                    clock="11:59",
                    game_elapsed_sec=game_elapsed_sec(1, "11:59"),
                    event_type="made_shot",
                    description="Test Player makes 2PT layup",
                    player_name="Test Player",
                    team_name="Test Team",
                )
            ],
        )
        manager = LiveSessionManager(provider=StaticGameDataProvider(package))
        manager._visual_observation = AsyncMock(return_value=None)  # type: ignore[method-assign]
        fd, temp_video = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)

        with patch("live_sessions._download_video_temp", AsyncMock(return_value=temp_video)), patch(
            "live_sessions._video_duration_sec",
            return_value=1.0,
        ):
            session = await manager.create_session(
                LiveSessionConfig(
                    file_url="https://example.test/video.mp4",
                    nba_game_id="fixture",
                    start_period=1,
                    start_clock="12:00",
                    cadence_sec=1,
                    window_sec=2,
                    replay_speed=8,
                )
            )
            seen_caption = None
            async for raw in manager.event_stream(session.session_id):
                if '"type": "caption"' in raw:
                    seen_caption = raw
                    break
                if '"type": "complete"' in raw:
                    break
            self.assertIsNotNone(seen_caption)
            self.assertIn('"latency_ms"', seen_caption)
            self.assertIn('"source": "feed"', seen_caption)
            await asyncio.sleep(0)

    async def test_session_stream_emits_feed_context_when_no_exact_event_matches(self):
        package = LiveGamePackage(
            game_id="fixture",
            teams=[
                LiveTeam(team_id="1", name="Test Team", abbreviation="TST"),
                LiveTeam(team_id="2", name="Opponent", abbreviation="OPP"),
            ],
            events=[
                LiveGameEvent(
                    event_id="prior",
                    period=1,
                    clock="11:50",
                    game_elapsed_sec=10,
                    event_type="made_shot",
                    description="Test Player makes 2PT layup",
                    player_name="Test Player",
                    team_name="Test Team",
                    score="2-0",
                ),
                LiveGameEvent(
                    event_id="next",
                    period=1,
                    clock="11:20",
                    game_elapsed_sec=40,
                    event_type="turnover",
                    description="Opponent bad pass turnover",
                    team_name="Opponent",
                ),
            ],
        )
        manager = LiveSessionManager(provider=StaticGameDataProvider(package))
        manager._visual_observation = AsyncMock(
            return_value=VisualObservation("players move through a half-court set", 0.6, changed=True)
        )  # type: ignore[method-assign]
        fd, temp_video = tempfile.mkstemp(suffix=".mp4")
        os.close(fd)

        with patch("live_sessions._download_video_temp", AsyncMock(return_value=temp_video)), patch(
            "live_sessions._video_duration_sec",
            return_value=20.0,
        ):
            session = await manager.create_session(
                LiveSessionConfig(
                    file_url="https://example.test/video.mp4",
                    nba_game_id="fixture",
                    start_period=1,
                    start_clock="11:45",
                    cadence_sec=1,
                    window_sec=2,
                    replay_speed=8,
                )
            )
            seen_caption = None
            async for raw in manager.event_stream(session.session_id):
                if '"type": "caption"' in raw:
                    seen_caption = raw
                    break
                if '"type": "complete"' in raw:
                    break
            self.assertIsNotNone(seen_caption)
            self.assertIn('"source": "feed_context_with_vision"', seen_caption)
            self.assertIn('"feed_context"', seen_caption)
            self.assertNotIn('"source": "vision_only"', seen_caption)


if __name__ == "__main__":
    unittest.main()
