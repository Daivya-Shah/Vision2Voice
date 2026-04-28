# Architecture

Vision2Voice is a React/Vite frontend, a Python FastAPI backend, and a Supabase persistence layer. The system has two processing paths for clip analysis and one direct-backend path for Live Replay.

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Web app | `src/` | Uploads videos, starts analysis, renders results, starts Live Replay sessions, consumes SSE. |
| FastAPI backend | `backend/main.py` | Analysis API, live replay API, OpenAI calls, media processing, Supabase persistence. |
| Timeline helpers | `backend/timeline.py` | Normalize possession segments and align commentary/visual summary. |
| Live replay engine | `backend/live_sessions.py`, `backend/live_state.py`, `backend/live_game_data.py` | Load NBA data, align replay clock, reconcile feed and vision, stream captions. |
| Voiceover exporter | `backend/voiceover_export.py` | Generate TTS audio and mux it with the source clip using FFmpeg. |
| Supabase | `supabase/migrations/` | Storage, analysis tables, evaluation tables, live session tables. |
| Edge Function | `supabase/functions/process-video/index.ts` | Browser-callable proxy or mock analysis function. |

## Clip Analysis Paths

### Direct Backend Path

Used when `VITE_BACKEND_URL` is set.

```text
Browser
  -> Supabase Storage upload
  -> FastAPI POST /analyze
  -> download video from file_url
  -> sample frames with OpenCV
  -> OpenAI vision or fallback
  -> optional NBA roster enrichment
  -> timeline commentary
  -> local knowledge retrieval
  -> optional Supabase persistence
  -> browser renders result
```

This path is required for:

- Voiceover export.
- Live Replay.
- Local development without deploying a public backend.

### Supabase Edge Function Path

Used when `VITE_BACKEND_URL` is omitted.

```text
Browser
  -> Supabase Storage upload
  -> Supabase Edge Function process-video
  -> if VISION2VOICE_BACKEND_URL is set: proxy to FastAPI
  -> otherwise: return mock analysis
  -> persist detection/context/commentary rows
  -> browser renders result
```

This path is useful for static frontend deployments where the browser should not know a backend origin or when mocking the app without OpenAI.

## Backend Analysis Pipeline

`POST /analyze` calls `run_analyze`:

1. Download the source video with `httpx`.
2. Decode and sample frames with OpenCV.
3. If `OPENAI_API_KEY` exists, call the configured vision model.
4. If no key exists, return a deterministic fallback detection.
5. Normalize possession timeline segments.
6. Generate one commentary line per segment.
7. Build a visual summary aligned to the timeline.
8. Retrieve player/team facts from `backend/data/knowledge.json`.
9. Persist detections, context, and commentary when Supabase service credentials are configured.
10. Return an `AnalysisResult` to the client.

## Regeneration Pipeline

`POST /regenerate` prefers stored analysis rows:

1. Read the latest `detections` and `retrieved_context` rows for the clip.
2. If a usable detection exists, regenerate commentary only.
3. If not, re-run the full analysis pipeline with a higher commentary temperature.
4. Persist only a new commentary row when the detection was reused.

This keeps regeneration faster and avoids paying for vision when previous structured results are available.

## Voiceover Pipeline

`POST /export-commentary-video` requires `OPENAI_API_KEY`.

Two modes are supported:

- **Timeline mode:** when `possession_timeline` and `segment_commentary_lines` are present and have the same non-zero length, the backend creates segment-aligned audio.
- **Single-text mode:** otherwise it generates one audio track from `commentary_text`.

The backend uses OpenAI TTS and FFmpeg from `imageio-ffmpeg` to produce `vision2voice-voiceover.mp4`.

## Live Replay Pipeline

Live Replay requires direct backend mode.

```text
Browser /live
  -> optional POST /live/uploads
  -> GET /live/teams
  -> GET /live/games/search
  -> POST /live/sessions
  -> GET /live/sessions/{id}/events
  -> SSE captions/ticks/status
```

The backend:

1. Downloads or serves the replay file.
2. Loads NBA teams, rosters, and play-by-play with `nba_api`.
3. Builds a pregame knowledge packet.
4. Aligns replay seconds to NBA period and game clock.
5. Emits periodic `tick` events.
6. Emits `caption` events from feed events, feed context, and optional vision observations.
7. Persists live sessions/captions when Supabase service credentials are configured.

## Source of Truth Rules

- For standard clip analysis, vision output is the primary structured source.
- For Live Replay, structured NBA play-by-play is the primary source of truth.
- Live Replay vision is supporting evidence and should be cautious when it conflicts with feed data.
- Local knowledge is supplemental context, not a replacement for official game data.

## Persistence Boundaries

The browser can insert basic Supabase rows under the current permissive RLS policies. The backend uses `SUPABASE_SERVICE_ROLE_KEY` only server-side for persistence during direct backend mode. The service role key must never be exposed to Vite.
