# Live Replay

Live Replay turns a prerecorded basketball video into a simulated live caption stream. It is available at `/live` and requires direct FastAPI mode.

## Requirements

- Root `.env` includes `VITE_BACKEND_URL`.
- Backend is running and reachable from the browser.
- `nba_api` can reach stats.nba.com.
- Replay video is accessible by the backend, either through URL mode or local upload mode.
- `OPENAI_API_KEY` is optional but required for AI-generated live vision/text. Template/feed behavior can run without it.

## User Flow

1. Open `/live`.
2. Choose upload mode or URL mode.
3. Search NBA games by team, opponent, season, and season type.
4. Select or enter a game ID.
5. Enter the starting period and clock for the replay.
6. Start the session.
7. The UI opens an SSE connection; the video player's play/pause/seek events control the replay clock.
8. Stop the session or let the replay complete.

## Inputs

| Input | Meaning |
| --- | --- |
| `file_url` | Video URL the backend can download. Local upload mode creates this URL through `/live/uploads`. |
| `nba_game_id` | NBA game ID used to load play-by-play and rosters. |
| `start_period` | Period where the replay begins. |
| `start_clock` | Game clock at replay start, for example `11:36`. |
| `cadence_sec` | How often the replay loop emits ticks and evaluates captions. |
| `window_sec` | Visual observation window size. |
| `replay_speed` | Playback speed for the backend replay loop. |
| `clock_mode` | `replay_media` means the browser video clock controls replay advancement. |

## Backend Session Lifecycle

1. `POST /live/sessions` creates a `LiveSession`.
2. The manager downloads or receives the replay video.
3. `live_game_data.py` loads game data and normalizes events.
4. `live_kb.py` builds the pregame knowledge packet from teams and players.
5. The session waits in `ready` until the browser video starts playing.
6. The session loop maps replay seconds to game period/clock while status is `running`.
7. The loop emits `tick` events for UI progress.
8. The reconciler emits `caption` events when feed events or feed context justify one.
9. The stream emits `complete`, `stopped`, or `error`.

Pausing the video sends `state: "paused"` to the backend, which stops ticks and caption generation. Seeking sends the new video `currentTime`, and the backend emits a tick for the corresponding game clock before continuing.

## Feed and Vision Reconciliation

Live Replay prioritizes structured game data:

- Exact unseen play-by-play events produce `feed` captions.
- Already elapsed feed context can produce `feed_context_with_vision` captions.
- Vision observations can support captions when `LIVE_VISION_ENABLED=1`.
- Vision-only behavior should be cautious because official play-by-play is the source of truth.

The frontend displays source labels such as:

| Source | Meaning |
| --- | --- |
| `feed` | Caption is based on an official feed event. |
| `feed_with_vision` | Feed event with visual support. |
| `feed_context_with_vision` | Caption is based on elapsed feed context plus visual observation. |

## SSE Events

The frontend opens:

```text
GET /live/sessions/{session_id}/events
```

Important event types:

- `session_ready`: metadata and warnings.
- `tick`: replay time, duration, period, and clock.
- `caption`: generated caption and metadata.
- `complete`: replay finished.
- `stopped`: stop request completed.
- `error`: failure state.
- `ping`: keepalive.

The frontend also calls:

```text
POST /live/sessions/{session_id}/playback
```

with:

```json
{
  "state": "playing",
  "replay_time_sec": 24.2,
  "playback_rate": 1
}
```

Use `playing` to advance captions and `paused` to hold them at the current replay position.

## Local Upload Mode

When the backend is available, uploaded replay files are sent to:

```text
POST /live/uploads?filename=replay.mp4
```

The backend writes the file to:

```text
{system-temp}/vision2voice-live-uploads
```

It then serves it back through:

```text
GET /live/uploads/{upload_id}
```

This avoids depending on Supabase Storage limits for larger replay files during local development.

## Game Search

The UI calls:

```text
GET /live/games/search?team=WAS&opponent=CHA&season=2023-24&season_type=Regular%20Season
```

The backend resolves team names/abbreviations, calls NBA game finder APIs, normalizes home/away teams, and returns candidate game IDs.

## Operational Limits

- stats.nba.com access can be rate-limited or blocked by network conditions.
- Replay alignment is only as good as the chosen start period and clock.
- Local upload files are temporary and should not be treated as durable storage.
- SSE streams are in-memory per backend process.
- Multiple backend instances need external session coordination before Live Replay can scale horizontally.

## Recommended Defaults

For local testing:

```json
{
  "cadence_sec": 3,
  "window_sec": 6,
  "replay_speed": 1,
  "clock_mode": "replay_media"
}
```

For faster tests or fixtures, use a higher `replay_speed` and shorter video.
