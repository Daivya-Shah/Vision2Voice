# API Reference

The FastAPI backend is defined in `backend/main.py`. Direct browser calls require `VITE_BACKEND_URL` and matching backend CORS settings.

## Shared Types

### `AnalysisResult`

```json
{
  "event_type": "Three-Point Shot",
  "player_name": "Stephen Curry",
  "team_name": "Golden State Warriors",
  "confidence": 0.94,
  "visual_summary": "Timeline-aligned visual summary.",
  "retrieved_context": {
    "player_stats": {},
    "team_stats": {}
  },
  "commentary_text": "Generated commentary.",
  "model_name": "gpt-4o-mini+timeline+gpt-4o-mini",
  "possession_timeline": [
    {
      "t0": 0,
      "t1": 0.35,
      "event_type": "Other",
      "player_name": "Unknown",
      "team_name": "Unknown"
    }
  ],
  "segment_commentary_lines": ["Segment-level commentary."]
}
```

Notes:

- `confidence` is clamped to `0.0` through `1.0`.
- `t0` and `t1` are normalized time positions used by the UI against video duration.
- `retrieved_context` can be absent or `null` when no local facts match.

## Health

### `GET /health`

Returns backend liveness.

Response:

```json
{ "status": "ok" }
```

## Clip Analysis

### `POST /analyze`

Runs the full clip analysis pipeline.

Request:

```json
{
  "clip_id": "8df46c2c-e89a-4d8e-bb35-f678d60f072f",
  "file_url": "https://example.com/video.mp4"
}
```

Response: `AnalysisResult`.

Persistence:

- Inserts `detections`, `retrieved_context`, and `commentaries` rows when backend Supabase service credentials are configured.
- The Edge Function also persists these rows in Edge mode.

Errors:

- `502` when the video download fails.
- `500` for decode, model, or unexpected pipeline failures.

### `POST /regenerate`

Regenerates commentary for a clip.

Request:

```json
{
  "clip_id": "8df46c2c-e89a-4d8e-bb35-f678d60f072f",
  "file_url": "https://example.com/video.mp4"
}
```

Response: `AnalysisResult`.

Behavior:

- If a stored detection exists, it reuses detection/context and adds a new commentary row.
- If no stored detection exists, it re-runs full analysis.
- Regenerated stored-detection responses currently return empty `possession_timeline` and `segment_commentary_lines`.

## Voiceover Export

### `POST /export-commentary-video`

Generates an MP4 with AI commentary audio.

Requires backend `OPENAI_API_KEY`.

Request, simple mode:

```json
{
  "file_url": "https://example.com/video.mp4",
  "commentary_text": "Generated commentary to synthesize."
}
```

Request, timeline mode:

```json
{
  "file_url": "https://example.com/video.mp4",
  "commentary_text": "Fallback commentary.",
  "possession_timeline": [
    { "t0": 0, "t1": 0.35, "event_type": "Other", "player_name": "Player", "team_name": "Team" }
  ],
  "segment_commentary_lines": ["Segment narration."]
}
```

Response:

- `200`
- `Content-Type: video/mp4`
- Filename: `vision2voice-voiceover.mp4`

Errors:

- `503` when `OPENAI_API_KEY` is missing.
- `500` for TTS, download, duration probing, or FFmpeg failures.

## Live Replay Uploads

### `POST /live/uploads?filename={filename}`

Uploads a replay file directly to the local backend temp directory. This avoids Supabase Storage limits during local replay work.

Request:

- Raw file body.
- `Content-Type` should match the media type when available.
- Accepted extensions are normalized to `.mp4`, `.mov`, `.m4v`, or `.webm`; other extensions are stored as `.mp4`.

Response:

```json
{
  "upload_id": "909d0d5319b54f7e94ee7350d460d652",
  "file_url": "http://127.0.0.1:8000/live/uploads/909d0d5319b54f7e94ee7350d460d652",
  "filename": "replay.mp4",
  "size_bytes": 123456
}
```

Errors:

- `400` when the body is empty.

### `GET /live/uploads/{upload_id}`

Serves a previously uploaded local replay file.

Response:

- `200`
- `Content-Type: video/mp4`

Errors:

- `404` for malformed or unknown upload IDs.

## Live Teams and Game Search

### `GET /live/teams`

Returns NBA teams from `nba_api`.

Response:

```json
[
  {
    "team_id": "1610612738",
    "name": "Boston Celtics",
    "abbreviation": "BOS",
    "city": "Boston"
  }
]
```

### `GET /live/games/search`

Searches games by team, opponent, season, and season type.

Query parameters:

| Parameter | Required | Description |
| --- | --- | --- |
| `team` | Yes | Team name, abbreviation, or accepted shorthand. |
| `opponent` | Yes | Opponent name, abbreviation, or accepted shorthand. |
| `season` | Yes | NBA season string, for example `2023-24`. |
| `season_type` | No | Defaults to `Regular Season`; also supports `Playoffs`. |
| `limit` | No | Defaults to `20`; capped to `1..50`. |

Response:

```json
[
  {
    "game_id": "0022300157",
    "game_date": "2023-11-08",
    "season": "2023-24",
    "season_type": "Regular Season",
    "matchup": "WAS @ CHA",
    "team_abbreviation": "WAS",
    "opponent_abbreviation": "CHA",
    "home_team": "CHA",
    "away_team": "WAS",
    "team_score": 132,
    "opponent_score": 116,
    "score": "132-116",
    "result": "W"
  }
]
```

Errors:

- `400` for invalid team or query values.
- `502` when NBA data lookup fails.

## Live Sessions

### `POST /live/sessions`

Starts a simulated-live replay session.

Request:

```json
{
  "file_url": "https://example.com/replay.mp4",
  "nba_game_id": "0022300157",
  "start_period": 1,
  "start_clock": "12:00",
  "cadence_sec": 3,
  "window_sec": 6,
  "replay_speed": 1,
  "clock_mode": "replay_media"
}
```

Field constraints:

| Field | Constraint |
| --- | --- |
| `start_period` | `1..10` |
| `cadence_sec` | `1.0..10.0` |
| `window_sec` | `2.0..20.0` |
| `replay_speed` | `0.25..8.0` |
| `clock_mode` | Defaults to `replay_media` for client-controlled replay playback. |

Response:

```json
{
  "session_id": "d8d3b9ef-5692-448b-b7a5-5cf606981fa5",
  "status": "running",
  "team_names": ["Washington Wizards", "Charlotte Hornets"],
  "event_count": 480,
  "warnings": []
}
```

### `GET /live/sessions/{session_id}/events`

Opens the Server-Sent Events stream for a live session.

Response headers include:

```text
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

Event types:

| Event | Purpose |
| --- | --- |
| `connected` | Client connected to session stream. |
| `session_ready` | Session metadata is ready. |
| `status` | Session status changed. |
| `tick` | Replay time and game clock update. |
| `caption` | Commentary caption. |
| `complete` | Replay finished. |
| `stopped` | Session stopped by request. |
| `error` | Session failed. |
| `ping` | Keepalive. |

`caption` payload:

```json
{
  "type": "caption",
  "session_id": "d8d3b9ef-5692-448b-b7a5-5cf606981fa5",
  "event_id": "123",
  "period": 1,
  "clock": "11:36",
  "event_type": "made_shot",
  "player_name": "Test Player",
  "team_name": "Test Team",
  "score": "2-0",
  "text": "Generated caption.",
  "source": "feed_context_with_vision",
  "confidence": 0.75,
  "model_name": "gpt-4o-mini",
  "replay_time_sec": 24,
  "feed_description": "Official play-by-play text.",
  "visual_summary": "Short vision observation.",
  "feed_context": {
    "period": 1,
    "clock": "11:36",
    "teams": ["Test Team", "Opponent"],
    "last_score": "2-0",
    "nearest_prior_event": {}
  },
  "latency_ms": 125
}
```

`tick` payload:

```json
{
  "type": "tick",
  "session_id": "d8d3b9ef-5692-448b-b7a5-5cf606981fa5",
  "replay_time_sec": 24,
  "duration_sec": 120,
  "period": 1,
  "clock": "11:36"
}
```

### `POST /live/sessions/{session_id}/playback`

Updates the replay media clock. The frontend calls this from the video element's play, pause, seek, and playback-rate events.

Request:

```json
{
  "state": "playing",
  "replay_time_sec": 24.2,
  "playback_rate": 1
}
```

Behavior:

- `playing` changes session status to `running`; ticks and captions advance from `replay_time_sec`.
- `paused` changes session status to `paused`; ticks and captions stop advancing.
- Seeking sends the new `replay_time_sec`; the backend emits a `tick` for the aligned game clock.
- `replay_time_sec` is clamped to the replay duration once the backend has probed the video.

Response:

```json
{ "status": "playing" }
```

Errors:

- `404` when the session does not exist.

### `POST /live/sessions/{session_id}/stop`

Requests a session stop.

Response:

```json
{ "status": "stopping" }
```

Errors:

- `404` when the session does not exist.
