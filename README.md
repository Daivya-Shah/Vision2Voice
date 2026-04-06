# Vision2Voice

**Vision2Voice** turns short basketball broadcast clips into structured play understanding, retrieved stats, TV-style commentary, and optional AI voiceover. Upload an MP4 to the web app; the pipeline samples frames, calls a multimodal vision model, enriches names with optional NBA rosters, pulls context from a local knowledge base, and generates time-aligned commentary.

---

## What you get

- **Vision + timeline** — Evenly sampled frames (OpenCV) → OpenAI vision JSON with a **possession timeline** (who has the ball, when it changes).
- **Optional NBA roster match** — Jersey number + team hints → player name via [`nba_api`](https://github.com/swar/nba_api) (stats.nba.com rosters). Does not replace hand-curated stat lines in `knowledge.json`.
- **Retrieval** — `backend/data/knowledge.json` supplies player/team snippets for the UI and for the separate **regenerate** commentary path.
- **Commentary** — One play-by-play line per timeline segment; visual summary is aligned to that timeline so text stays consistent.
- **Voiceover export** — OpenAI TTS + FFmpeg (`imageio-ffmpeg`) muxed into a downloadable MP4; timeline-aware when the client sends segment lines + timeline.
- **Supabase** — Video storage, `clips` metadata, detections, context, commentaries, and optional human **evaluations**.

---

## Architecture

```
Browser (React + Vite)
    │
    ├─► Supabase Storage (MP4) + Postgres (`clips`, …)
    │
    ├─► [A] Direct: POST /analyze → FastAPI (backend/main.py)
    │         → frames → vision → timeline commentary → persist (optional)
    │
    └─► [B] Edge: invoke `process-video`
              → mock OR proxy to public FastAPI (`VISION2VOICE_BACKEND_URL`)

Path [A] is used when `VITE_BACKEND_URL` is set. Path [B] when it is omitted.
```

---

## Tech stack

| Layer | Stack |
|--------|--------|
| Frontend | React 18, Vite, TypeScript, Tailwind, shadcn/ui, TanStack Query |
| Backend | Python 3, FastAPI, Uvicorn, OpenCV, OpenAI SDK, `nba_api`, httpx |
| Media | FFmpeg (via `imageio-ffmpeg`), OpenAI TTS |
| Data | Supabase (Storage + Postgres), Edge Functions (Deno) |
| Local RAG | `backend/data/knowledge.json` |

---

## Repository layout

```
├── src/                    # React app
│   ├── lib/analysis.ts     # analyze pipeline + voiceover export client
│   ├── pages/Index.tsx
│   └── components/ResultsPanel.tsx
├── backend/
│   ├── main.py             # FastAPI: /analyze, /regenerate, /export-commentary-video
│   ├── timeline.py         # timeline normalize + segment commentary + summary align
│   ├── jersey_resolve.py   # NBA roster enrichment
│   ├── voiceover_export.py # TTS + FFmpeg mux
│   ├── openai_retry.py     # retry on 429 / transient errors
│   ├── data/knowledge.json # curated player/team facts for retrieval UI
│   └── requirements.txt
├── supabase/
│   ├── migrations/         # apply to your Supabase project
│   └── functions/process-video/
├── scripts/dev-backend.mjs # runs uvicorn against backend/.venv
└── package.json            # npm run dev:full = Vite + API
```

---

## Prerequisites

- **Node.js** 18+ and npm  
- **Python** 3.11+ (recommended)  
- A **Supabase** project with Storage and migrations applied  
- **OpenAI API key** (vision + chat + TTS for full functionality)

---

## Supabase setup

1. Create a project in the [Supabase Dashboard](https://supabase.com/dashboard).  
2. Run SQL migrations from `supabase/migrations/` (SQL editor or `supabase db push` with CLI).  
3. Create a **Storage** bucket named **`videos`**. Allow public read (and upload policy for your auth model) so the backend can download clips by public URL.  
4. (Optional) Deploy the Edge Function `process-video` and set secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and optionally `VISION2VOICE_BACKEND_URL` to proxy to your hosted API.

---

## Environment variables

### Root `.env` (frontend — Vite)

Copy `.env.example` → `.env`. Only variables prefixed with `VITE_` are exposed to the browser.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable (anon) key |
| `VITE_BACKEND_URL` | No | If set (e.g. `http://127.0.0.1:8000`), the app calls FastAPI **directly**. If unset, it uses the **`process-video`** Edge Function. |

### `backend/.env` (Python)

Copy `backend/.env.example` → `backend/.env`. **Never commit real keys.**

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | For real analysis / TTS | Vision, timeline text, TTS, summary alignment |
| `SUPABASE_URL` | Optional | Persist results to Postgres (mirror Edge behavior) |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | **Server only** — with `SUPABASE_URL`, writes detections / context / commentaries |
| `CORS_ORIGINS` | For browser calls | Comma-separated origins; include your Vite dev origin and production URL |
| `FRAME_SAMPLE_COUNT` | Optional | Default `16` — frame count for vision |
| `NBA_ROSTER_LOOKUP` | Optional | Set `0` to disable jersey→name roster pass |
| `VOICEOVER_PLAYBACK_SPEED` | Optional | Default `1.5` — natural TTS slot factor before tempo to fit video |
| `OPENAI_RETRY_*` | Optional | Backoff when OpenAI returns 429 / transient errors |

See `backend/.env.example` for model names, TTS voice, and NBA hint scoring.

---

## Local development

### 1. Clone and install frontend

```bash
npm install
```

### 2. Python virtualenv and dependencies

```bash
cd backend
python -m venv .venv
```

**Windows** (from `backend/`):

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
```

**macOS / Linux** (from `backend/`):

```bash
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure env files

- Root `.env`: `VITE_SUPABASE_*` and `VITE_BACKEND_URL=http://127.0.0.1:8000` for direct API mode.  
- `backend/.env`: at minimum `OPENAI_API_KEY`; add Supabase keys if you want the API to write rows.

### 4. CORS

`backend/.env.example` lists `http://localhost:8080` and `http://127.0.0.1:8080` because **this repo’s Vite dev server uses port 8080** (`vite.config.ts`). Add `5173` too if you change the port.

### 5. Run web + API together

From the **repository root**:

```bash
npm run dev:full
```

- **App:** [http://localhost:8080](http://localhost:8080) (check the terminal if the port differs).  
- **API health:** [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) → `{"status":"ok"}`.

Alternatively:

```bash
npm run dev          # frontend only
npm run dev:backend  # API only (expects backend/.venv)
```

---

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server |
| `npm run dev:backend` | Uvicorn `main:app` on port 8000 with reload |
| `npm run dev:full` | Both in parallel |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview production build locally |

---

## HTTP API (FastAPI)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Liveness check |
| `POST` | `/analyze` | Body: `{ "clip_id", "file_url" }` — full pipeline |
| `POST` | `/regenerate` | Uses latest stored detection from Supabase when available; otherwise re-analyzes |
| `POST` | `/export-commentary-video` | Body: `file_url`, `commentary_text`, optional `possession_timeline` + `segment_commentary_lines` for segment-aligned audio |

---

## Production notes

- **Frontend (e.g. Vercel):** set `VITE_SUPABASE_*` and either omit `VITE_BACKEND_URL` (Edge Function path) **or** set it to your **public HTTPS** API URL. Redeploy after changing `VITE_*` vars (they are baked in at build time).  
- **Backend (e.g. Render, Railway, Fly):** run `uvicorn main:app --host 0.0.0.0 --port $PORT` with root directory `backend`, install `requirements.txt`. Set `CORS_ORIGINS` to your real site origin(s), e.g. `https://your-app.vercel.app`.  
- **Secrets:** OpenAI and Supabase **service role** belong on the **server**, not in Vercel env for the static bundle (unless you add a serverless proxy).  
- Heavy deps (OpenCV, FFmpeg) may need a paid tier or Docker image on some hosts.

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| Blank / “Supabase key missing” | Root `.env` has `VITE_SUPABASE_URL` and publishable key; restart dev server after edits. |
| `Failed to fetch` from the browser | `VITE_BACKEND_URL` must be HTTPS in production; backend `CORS_ORIGINS` must include your frontend origin; API must be reachable. |
| OpenAI 429 | Rate limits; optional `OPENAI_RETRY_*` in `backend/.env`; reduce `FRAME_SAMPLE_COUNT` or vision detail. |
| Voiceover button disabled | `VITE_BACKEND_URL` must point to a backend with `OPENAI_API_KEY` — export is server-side. |
| Wrong player from jersey | Tune `NBA_TEAM_HINT_MIN_SCORE` or set `NBA_ROSTER_LOOKUP=0`; vision name is preferred over bad roster matches when it conflicts. |

---

## Extending the project

- Enrich or replace `knowledge.json` with live stats (e.g. more `nba_api` endpoints) — wire into `retrieve_context` and optionally into timeline prompts.  
- Add evaluation metrics (BLEU/ROUGE) against reference commentaries.  
- Tighter latency: smaller models, fewer frames, caching, or async queue.

---

## License

Use and attribution should follow your course, team, or employer policy for data, APIs, and third-party content.
