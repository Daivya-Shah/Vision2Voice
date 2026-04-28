# Troubleshooting

## App Shows Supabase Key Missing

Check root `.env`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Restart Vite after editing `.env`.

## Browser Fails to Reach Backend

Symptoms:

- `Failed to fetch`
- Live Replay says backend URL is missing
- Voiceover export is disabled

Checks:

- Root `.env` includes `VITE_BACKEND_URL=http://127.0.0.1:8000` for local direct mode.
- Backend is running with `npm run dev:backend` or `npm run dev:full`.
- `curl http://127.0.0.1:8000/health` returns `{"status":"ok"}`.
- `backend/.env` `CORS_ORIGINS` includes the Vite origin.
- In production, `VITE_BACKEND_URL` uses HTTPS.

## OpenAI Calls Fail or Fall Back

Checks:

- `backend/.env` contains `OPENAI_API_KEY`.
- Backend process was restarted after adding the key.
- The configured model names are valid for your account.
- Rate limits are not exceeded.
- Lower `FRAME_SAMPLE_COUNT` while testing.

Relevant retry settings:

```bash
OPENAI_RETRY_MAX_ATTEMPTS=6
OPENAI_RETRY_BASE_SEC=0.5
OPENAI_RETRY_MAX_WAIT_SEC=60
```

## Video Download Fails

Checks:

- `file_url` is publicly reachable by the backend.
- Supabase `videos` bucket is public or the URL is signed and valid.
- The video host allows backend server downloads.
- The URL does not require browser-only auth cookies.

Backend returns `502` for failed downloads in `/analyze`.

## Video Decode Fails

Symptoms:

- OpenCV cannot open the video.
- Analysis returns no decoded frames.

Checks:

- Use MP4/H.264 for best compatibility.
- Confirm the uploaded file is not empty.
- Try a shorter clip.
- Verify `opencv-python-headless` is installed in the backend environment.

## Voiceover Export Fails

Checks:

- Direct backend mode is enabled with `VITE_BACKEND_URL`.
- Backend has `OPENAI_API_KEY`.
- The backend can download the source `file_url`.
- `imageio-ffmpeg` is installed.
- `VOICEOVER_PLAYBACK_SPEED` is in a reasonable range, usually `1.0..2.0`.

The endpoint returns `503` when `OPENAI_API_KEY` is missing.

## Edge Function Returns Mock Data

This is expected when `VISION2VOICE_BACKEND_URL` is not set for the Supabase Edge Function.

Set:

```bash
VISION2VOICE_BACKEND_URL=https://api.example.com
```

Then redeploy or restart the Edge Function environment as required by Supabase.

## Regenerate Does Not Include Timeline Segments

When `/regenerate` reuses a stored detection, it generates commentary from stored detection/context and returns empty `possession_timeline` and `segment_commentary_lines`.

To regenerate timeline commentary, force or implement a full re-analysis path.

## Live Teams or Game Search Fails

Checks:

- Backend has internet access.
- `nba_api` is installed.
- stats.nba.com is reachable from the backend host.
- Team names or abbreviations are valid.
- Season uses NBA format, for example `2023-24`.
- Use `Regular Season` or `Playoffs` for `season_type`.

Backend returns `400` for invalid inputs and `502` for NBA lookup failures.

## Live Replay Captions Are Misaligned

Checks:

- Start period and start clock match the video's first frame.
- `replay_speed` matches expected backend simulation speed.
- The selected `nba_game_id` is the exact game in the replay.
- The replay clip has not been edited in a way that skips game time without adjusting start clock.

## Live Replay Stream Disconnects

Checks:

- Backend process is still running.
- Browser can reach `GET /live/sessions/{session_id}/events`.
- Proxies are not buffering SSE. For Nginx-like proxies, disable buffering for this route.
- Session ID exists in the current backend process.

Live sessions are currently in-memory, so a backend restart loses active sessions.

## Supabase Rows Are Not Written in Direct Backend Mode

Checks:

- `backend/.env` has `SUPABASE_URL`.
- `backend/.env` has `SUPABASE_SERVICE_ROLE_KEY`.
- Backend restarted after env changes.
- Service role key belongs to the same project as the frontend.
- Table names match current migrations.

## Local Replay Upload Fails

Checks:

- Direct backend mode is enabled.
- Uploaded body is not empty.
- File extension is one of `.mp4`, `.mov`, `.m4v`, or `.webm`; other extensions are stored as `.mp4`.
- OS temp directory is writable.

## Build Fails

Run:

```bash
npm run lint
npm run test
npm run build
```

Common causes:

- TypeScript type drift between backend response shape and `src/lib/*` types.
- Missing Vite env values at runtime, not build time.
- Stale generated Supabase types after schema changes.
