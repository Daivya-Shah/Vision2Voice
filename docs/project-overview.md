# Project Overview

Vision2Voice turns basketball broadcast clips into structured play understanding, contextual stats, broadcast-style commentary, and optional AI voiceover video exports.

The app supports two related workflows:

- **Clip analysis** on `/`: analyze a short uploaded basketball clip and produce event metadata, a possession timeline, retrieved player/team context, commentary, and voiceover export.
- **Live Replay Desk** on `/live`: treat a prerecorded video as a simulated live source, align replay time to an NBA game clock, and stream captions over Server-Sent Events.

## Goals

- Identify the key basketball event in a short clip.
- Preserve a time-ordered possession timeline instead of producing a single unstructured summary.
- Enrich output with curated local basketball knowledge and optional NBA roster lookup.
- Generate commentary that stays consistent with visual evidence and timeline segments.
- Offer a low-latency replay mode that uses NBA play-by-play as the source of truth.
- Persist analysis artifacts for later review and regeneration when Supabase service credentials are available.

## Non-Goals

- It is not a real broadcast ingest system. `/live` is simulated from replay files.
- It is not a full computer-vision tracking stack. Vision calls summarize sampled frames and short windows.
- It does not guarantee official stat correctness beyond the data returned by `nba_api`, local knowledge, and configured prompts.
- It does not implement production authentication or private multi-tenant data access by default.

## Repository Layout

```text
src/
  App.tsx                         React routes and app providers
  pages/Index.tsx                 Clip upload and analysis page
  pages/LiveReplay.tsx            Simulated live replay desk
  lib/analysis.ts                 Clip analysis and voiceover client
  lib/live.ts                     Live replay API and SSE client
  components/                     App components and shadcn/ui primitives
backend/
  main.py                         FastAPI application and endpoint wiring
  timeline.py                     Timeline normalization, commentary, and summary alignment
  jersey_resolve.py               Jersey/team hint roster enrichment
  live_game_data.py               NBA team/game/play-by-play lookup and clock alignment
  live_kb.py                      Pregame live knowledge packet
  live_sessions.py                Replay session lifecycle and SSE stream
  live_state.py                   Feed/vision reconciliation and caption generation
  voiceover_export.py             OpenAI TTS and FFmpeg video muxing
  data/knowledge.json             Curated local facts for retrieval
  tests/                          Backend unit and integration tests
supabase/
  migrations/                     Postgres schema and RLS policies
  functions/process-video/        Edge Function proxy/mock analysis path
scripts/
  dev-backend.mjs                 Uvicorn helper for `npm run dev:backend`
```

## Runtime Modes

### Direct FastAPI Mode

Set `VITE_BACKEND_URL`, usually to `http://127.0.0.1:8000`.

The browser calls the Python backend directly for `/analyze`, `/regenerate`, `/export-commentary-video`, and all `/live/*` endpoints. This is the preferred local development mode and the only mode that supports voiceover export and Live Replay from the browser.

### Supabase Edge Function Mode

Leave `VITE_BACKEND_URL` unset.

The browser invokes the `process-video` Edge Function. If `VISION2VOICE_BACKEND_URL` is configured in Supabase, the function proxies to the public FastAPI backend. If it is absent, the function returns mock analysis data and persists mock rows.

## Key Capabilities

- **Frame sampling:** OpenCV samples frames across the uploaded video.
- **Vision analysis:** OpenAI vision model extracts event type, player, team, confidence, summary, and possession segments.
- **Roster enrichment:** Optional `nba_api` roster lookup improves jersey-number based player identification.
- **Context retrieval:** `backend/data/knowledge.json` contributes player and team facts.
- **Timeline commentary:** One commentary line per timeline segment, then a combined commentary string.
- **Voiceover export:** OpenAI TTS and FFmpeg create a downloadable MP4 with generated commentary audio.
- **Live replay streaming:** Backend emits status, tick, caption, complete, stopped, error, and ping events over SSE.

## Important Constraints

- Root `.env` values prefixed with `VITE_` are embedded into the browser bundle.
- `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` must only be used on the backend or Supabase Edge Function.
- Local Live Replay uploads are stored in the OS temp directory and served by FastAPI for the session flow.
- The default Supabase migrations use permissive public RLS policies intended for a demo/tool environment.
