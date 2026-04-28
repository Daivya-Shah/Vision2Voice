# Local Development

## Prerequisites

- Node.js 18 or newer.
- npm.
- Python 3.11 or newer recommended.
- Supabase project with migrations applied.
- OpenAI API key for real vision, text, and TTS behavior.

## Install Frontend Dependencies

```bash
npm install
```

## Install Backend Dependencies

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

On Windows, activate with:

```powershell
cd backend
.venv\Scripts\python -m pip install -r requirements.txt
cd ..
```

## Configure Environment

Create root `.env` from `.env.example` and set:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_BACKEND_URL=http://127.0.0.1:8000
```

Create `backend/.env` from `backend/.env.example` and set at least:

```bash
OPENAI_API_KEY=...
CORS_ORIGINS=http://localhost:8080,http://127.0.0.1:8080
```

Add backend Supabase service credentials if you want the direct FastAPI path to persist rows:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Run the App

Run frontend and backend together from the repository root:

```bash
npm run dev:full
```

Default local URLs:

- Web app: `http://localhost:8080`
- Backend health: `http://127.0.0.1:8000/health`
- Live Replay page: `http://localhost:8080/live`

Run separately when debugging one side:

```bash
npm run dev
npm run dev:backend
```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite. |
| `npm run dev:backend` | Start Uvicorn through `scripts/dev-backend.mjs`. |
| `npm run dev:full` | Start Vite and Uvicorn together. |
| `npm run build` | Build production frontend assets. |
| `npm run build:dev` | Build frontend in development mode. |
| `npm run preview` | Preview the built frontend. |
| `npm run lint` | Run ESLint. |
| `npm run test` | Run Vitest frontend tests. |
| `npm run test:watch` | Run Vitest in watch mode. |

## Backend Tests

The backend tests use Python `unittest`.

```bash
cd backend
source .venv/bin/activate
python -m unittest discover tests
```

Current backend coverage includes:

- Live upload endpoint behavior.
- NBA clock alignment.
- team and game lookup normalization.
- live session streaming.
- feed-context caption behavior.

## Frontend Tests

```bash
npm run test
```

Current frontend tests cover:

- live utility formatting.
- local replay upload client behavior.
- page-level behavior for the main analysis and Live Replay screens.

## Local Supabase Notes

The repo is configured for a hosted Supabase project by default. If you use the Supabase CLI locally:

```bash
supabase db push
```

Then create or verify the `videos` storage bucket and confirm root `.env` points at the correct project URL and publishable key.

## Development Workflow

1. Start with direct backend mode for feature work.
2. Use short MP4/H.264 clips to reduce decode and OpenAI costs.
3. Keep `FRAME_SAMPLE_COUNT` low while iterating.
4. Run Vitest after frontend changes.
5. Run backend unittest discovery after backend or live replay changes.
6. Build before deployment-oriented changes:

```bash
npm run build
```

## Common Local Checks

Backend reachable:

```bash
curl http://127.0.0.1:8000/health
```

Vite env visible to browser:

- Restart Vite after changing root `.env`.
- Confirm `VITE_BACKEND_URL` is present for `/live` and voiceover export.

Python backend env loaded:

- `backend/main.py` loads `backend/.env`.
- Restart `npm run dev:backend` after changing backend env values.
