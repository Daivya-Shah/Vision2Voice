# Supabase Data Model

Supabase provides video storage, analysis persistence, evaluations, and optional Live Replay review tables.

## Storage

Bucket:

| Bucket | Public | Purpose |
| --- | --- | --- |
| `videos` | Yes | Uploaded clip and replay video files. |

Policies from the initial migration allow public read and public upload for the `videos` bucket.

## Analysis Tables

### `clips`

Stores video metadata.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key, default `gen_random_uuid()`. |
| `title` | TEXT | Optional display title. |
| `file_url` | TEXT | Public video URL. |
| `created_at` | TIMESTAMPTZ | Defaults to `now()`. |

### `detections`

Stores structured event detection for a clip.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `clip_id` | UUID | References `clips(id)` with cascade delete. |
| `event_type` | TEXT | Detected basketball event. |
| `player_name` | TEXT | Detected or enriched player name. |
| `team_name` | TEXT | Detected team name. |
| `confidence` | NUMERIC | Detection confidence. |
| `visual_summary` | TEXT | Timeline-aligned visual summary. |
| `created_at` | TIMESTAMPTZ | Defaults to `now()`. |

### `retrieved_context`

Stores local context returned for a clip.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `clip_id` | UUID | References `clips(id)` with cascade delete. |
| `player_stats_json` | JSONB | Player facts from local knowledge. |
| `team_stats_json` | JSONB | Team facts from local knowledge. |
| `created_at` | TIMESTAMPTZ | Defaults to `now()`. |

### `commentaries`

Stores generated commentary versions.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `clip_id` | UUID | References `clips(id)` with cascade delete. |
| `model_name` | TEXT | Model or pipeline label. |
| `commentary_text` | TEXT | Generated commentary. |
| `created_at` | TIMESTAMPTZ | Defaults to `now()`. |

Multiple commentary rows can exist for the same clip, especially after regeneration.

### `evaluations`

Stores optional human review scores.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `clip_id` | UUID | References `clips(id)` with cascade delete. |
| `fluency_score` | INTEGER | Human fluency score. |
| `factual_score` | INTEGER | Human factuality score. |
| `style_score` | INTEGER | Human style score. |
| `notes` | TEXT | Reviewer notes. |
| `created_at` | TIMESTAMPTZ | Defaults to `now()`. |

## Live Replay Tables

### `live_sessions`

Stores replay session metadata.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `file_url` | TEXT | Replay source URL. |
| `nba_game_id` | TEXT | NBA game ID used for play-by-play lookup. |
| `start_period` | INTEGER | Starting period for replay alignment. |
| `start_clock` | TEXT | Starting game clock, for example `12:00`. |
| `cadence_sec` | NUMERIC | Tick/caption cadence. |
| `window_sec` | NUMERIC | Rolling visual window size. |
| `status` | TEXT | Session state. |
| `warnings_json` | JSONB | Non-fatal setup warnings. |
| `created_at` | TIMESTAMPTZ | Defaults to `now()`. |
| `ended_at` | TIMESTAMPTZ | Set when the session ends when persistence is configured. |

### `live_captions`

Stores emitted live replay captions.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Primary key. |
| `session_id` | UUID | References `live_sessions(id)` with cascade delete. |
| `event_id` | TEXT | NBA feed event ID when available. |
| `period` | INTEGER | NBA period. |
| `game_clock` | TEXT | NBA clock. |
| `event_type` | TEXT | Feed/derived event type. |
| `player_name` | TEXT | Player when available. |
| `team_name` | TEXT | Team when available. |
| `score` | TEXT | Score string when available. |
| `caption_text` | TEXT | Emitted caption. |
| `source` | TEXT | `feed`, `feed_with_vision`, `feed_context_with_vision`, or related source label. |
| `confidence` | NUMERIC | Caption confidence. |
| `latency_ms` | INTEGER | Measured replay caption latency. |
| `model_name` | TEXT | Model or template label. |
| `feed_description` | TEXT | Official play-by-play description. |
| `visual_summary` | TEXT | Optional visual observation. |
| `feed_context_json` | JSONB | Nearby event context. |
| `created_at` | TIMESTAMPTZ | Defaults to `now()`. |

## Persistence Rules

Direct FastAPI mode persists only when both backend variables are present:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Edge Function mode persists through the function's Supabase service client.

For `POST /analyze`:

- insert detection.
- insert retrieved context.
- insert commentary.

For `POST /regenerate`:

- when stored detection is reused, insert commentary only.
- when full analysis reruns, insert detection, retrieved context, and commentary.

For Live Replay:

- session and caption persistence is optional and depends on backend Supabase service credentials.

## Edge Function Behavior

`process-video` accepts:

```json
{
  "clip_id": "uuid",
  "file_url": "https://...",
  "action": "regenerate"
}
```

If `VISION2VOICE_BACKEND_URL` is set, it proxies to:

- `/analyze`
- `/regenerate` when `action` is `regenerate`

If `VISION2VOICE_BACKEND_URL` is not set, it returns deterministic mock analysis and persists mock rows.

## RLS Posture

The current migrations enable RLS and then add broad public read/insert policies, plus public update on commentaries, evaluations, and live sessions.

This is suitable for a demo or unauthenticated tool. For production, tighten policies around:

- authenticated clip ownership.
- private storage objects.
- server-only inserts for detections and retrieved context.
- restricted updates to evaluations and live session statuses.
- service-role-only writes from the backend or Edge Function.
