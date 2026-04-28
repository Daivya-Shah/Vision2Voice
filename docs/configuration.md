# Configuration

Configuration is split between the browser bundle and the Python backend. Anything prefixed with `VITE_` can be exposed to users because Vite embeds it in frontend JavaScript.

## Root `.env`

Used by the React/Vite app.

| Variable | Required | Description |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Yes | Supabase project URL. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable/anon key used by the browser. |
| `VITE_BACKEND_URL` | No | Direct FastAPI base URL. Set it for local development, Live Replay, and voiceover export. Omit it to use the Supabase Edge Function path. |

Example:

```bash
VITE_SUPABASE_URL=https://example.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_BACKEND_URL=http://127.0.0.1:8000
```

## Backend `.env`

Used by `backend/main.py`.

| Variable | Required | Description |
| --- | --- | --- |
| `OPENAI_API_KEY` | For real AI behavior | Enables vision, text commentary, summary alignment, live vision captions, and TTS. Without it, analysis falls back to templates and voiceover export is unavailable. |
| `OPENAI_VISION_MODEL` | No | Vision model for clip analysis. Default: `gpt-4o-mini`. |
| `OPENAI_VISION_IMAGE_DETAIL` | No | Image detail for OpenAI vision calls: `low`, `high`, or `auto`. Default: `high`. |
| `OPENAI_TEXT_MODEL` | No | Text model for commentary. Default: `gpt-4o-mini`. |
| `OPENAI_TTS_MODEL` | No | TTS model. Default: `tts-1`. |
| `OPENAI_TTS_VOICE` | No | TTS voice. Default: `onyx`. |
| `FRAME_SAMPLE_COUNT` | No | Number of frames sampled from clips. Default: `16`. |
| `NBA_ROSTER_LOOKUP` | No | Set `0` to disable jersey-to-player roster enrichment. Default: enabled. |
| `NBA_TEAM_HINT_MIN_SCORE` | No | Minimum fuzzy score for team hint matching. Default from example: `35`. |
| `LIVE_VISION_ENABLED` | No | Set `0` to skip OpenAI calls in the live replay hot path. Default from example: enabled. |
| `VOICEOVER_PLAYBACK_SPEED` | No | Audio slot/speed factor for voiceover fitting. Default: `1.5`. |
| `SUPABASE_URL` | Optional | Backend Supabase project URL for server-side persistence. |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-only key for backend writes. Never expose to Vite. |
| `CORS_ORIGINS` | Browser direct mode | Comma-separated frontend origins allowed by FastAPI. Use local Vite and production origins. |
| `OPENAI_RETRY_MAX_ATTEMPTS` | No | Max retry attempts for transient OpenAI errors. |
| `OPENAI_RETRY_BASE_SEC` | No | Initial retry backoff. |
| `OPENAI_RETRY_MAX_WAIT_SEC` | No | Maximum retry wait. |

Example:

```bash
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-4o-mini
OPENAI_VISION_IMAGE_DETAIL=high
OPENAI_TEXT_MODEL=gpt-4o-mini
OPENAI_TTS_MODEL=tts-1
OPENAI_TTS_VOICE=onyx
FRAME_SAMPLE_COUNT=16
NBA_ROSTER_LOOKUP=1
LIVE_VISION_ENABLED=1
SUPABASE_URL=https://example.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

## Supabase Edge Function Secrets

Used by `supabase/functions/process-video`.

| Secret | Required | Description |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Lets the Edge Function persist detections, retrieved context, and commentaries. |
| `VISION2VOICE_BACKEND_URL` | No | Public FastAPI backend URL. If omitted, the Edge Function returns mock data. |

## CORS

For direct backend mode, the browser calls FastAPI from the Vite origin. Include every expected frontend origin in `CORS_ORIGINS`.

Local examples:

```bash
CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173
```

Production example:

```bash
CORS_ORIGINS=https://your-app.vercel.app
```

The backend also allows localhost and `127.0.0.1` ports through a regex when explicit origins are configured.

## Configuration Decision Matrix

| Need | Required Config |
| --- | --- |
| Analyze clips locally | Root `VITE_BACKEND_URL`, backend `OPENAI_API_KEY`. |
| Analyze clips through Edge Function | Root omits `VITE_BACKEND_URL`, Edge Function deployed. |
| Edge Function proxies real backend | Edge `VISION2VOICE_BACKEND_URL`. |
| Edge Function mock mode | Edge `VISION2VOICE_BACKEND_URL` omitted. |
| Voiceover export | Root `VITE_BACKEND_URL`, backend `OPENAI_API_KEY`. |
| Live Replay | Root `VITE_BACKEND_URL`, backend dependencies, accessible replay file or local upload. |
| Persist direct backend analysis | Backend `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. |
