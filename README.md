# Vision2Voice

Basketball clip → **vision (frames + OpenAI)** → **stat retrieval** (`knowledge.json`) → **commentary**, with a React UI and Supabase (storage + Postgres).

## Quick start (everything on your PC)

You do **not** need ngrok or the Edge Function for local development.

1. **Supabase** (once): apply `supabase/migrations/`, ensure Storage bucket **`videos`** is public for read/upload.

2. **Root `.env`**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and:

   ```env
   VITE_BACKEND_URL=http://127.0.0.1:8000
   ```

3. **Backend** (once):

   ```bash
   cd backend
   python -m venv .venv
   backend\.venv\Scripts\pip install -r requirements.txt   # Windows
   # source .venv/bin/activate && pip install -r requirements.txt   # macOS/Linux
   ```

4. **`backend/.env`**: set **`OPENAI_API_KEY`**. For saving rows from the API into Postgres (same as the Edge Function), also set **`SUPABASE_SERVICE_ROLE_KEY`** (Dashboard → Settings → API → `service_role` — server only, never in the frontend).

5. **Run app + API together:**

   ```bash
   npm install
   npm run dev:full
   ```

   - Web: Vite (usually `http://localhost:5173`)
   - API: `http://127.0.0.1:8000/health` should return `{"status":"ok"}`

6. Upload an **MP4** clip. With `VITE_BACKEND_URL` set, the browser talks **directly** to FastAPI; the backend downloads the public Storage URL and runs the pipeline.

**Remove** `VITE_BACKEND_URL` from `.env` if you want the UI to use only the **Supabase Edge Function** (mock, or real backend via `VISION2VOICE_BACKEND_URL`).

## Architecture

1. **Frontend**: uploads to Storage, inserts `clips`, then either **`VITE_BACKEND_URL`** (`/analyze`) or **`process-video`** Edge Function.
2. **Edge Function** (`supabase/functions/process-video`): mock, or proxy to a **public** Python URL (`VISION2VOICE_BACKEND_URL`).
3. **Backend** (`backend/main.py`): download clip → OpenCV frames → OpenAI vision + commentary → optional Supabase **persist** (when `SUPABASE_SERVICE_ROLE_KEY` is set).

## Production / remote backend

Expose FastAPI (Railway, Fly, etc.) or use a tunnel, then set Edge secret **`VISION2VOICE_BACKEND_URL`** (no trailing slash). Omit **`VITE_BACKEND_URL`** in the hosted frontend so clients use the Edge Function.

## Extending the research pipeline

- Swap `knowledge.json` for **NBA Stats** / `nba_api`.
- Add **CLIP/ViT** + a classifier; keep an LLM for language.
- Add **BLEU/ROUGE** + entity checks against `commentaries` and your references.

## License

Follow your course / team policy for data and video.
