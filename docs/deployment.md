# Deployment

Vision2Voice can be deployed as a static frontend plus a public FastAPI backend, with Supabase for storage and persistence.

## Frontend

Deploy the Vite build to a static host such as Vercel, Netlify, or Supabase hosting.

Build command:

```bash
npm run build
```

Output directory:

```text
dist
```

Production frontend variables:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_PUBLISHABLE_KEY=...
```

Set `VITE_BACKEND_URL` only when the browser should call the public backend directly:

```bash
VITE_BACKEND_URL=https://api.example.com
```

If `VITE_BACKEND_URL` is omitted, the frontend uses the Supabase Edge Function path.

## Backend

Deploy `backend/` as a Python web service.

Start command:

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Install command:

```bash
pip install -r requirements.txt
```

Required production backend variables for real behavior:

```bash
OPENAI_API_KEY=...
CORS_ORIGINS=https://your-frontend.example
```

Optional persistence:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Supabase

Apply migrations:

```bash
supabase db push
```

Verify:

- `videos` bucket exists and is public if the backend will download public URLs.
- analysis tables exist.
- live replay tables exist if `/live` will be used.
- RLS policies match your intended security model.

## Edge Function

Deploy `supabase/functions/process-video`.

Secrets:

```bash
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
VISION2VOICE_BACKEND_URL=https://api.example.com
```

If `VISION2VOICE_BACKEND_URL` is omitted, the function returns mock data. That is useful for demos but not production analysis.

## Direct Backend vs Edge Proxy

| Deployment Choice | Pros | Cons |
| --- | --- | --- |
| Browser calls FastAPI directly | Supports all backend features, simpler debugging, required for Live Replay and voiceover. | Requires public API, CORS, and stable backend URL in Vite build. |
| Browser calls Edge Function | Keeps API routing behind Supabase and can mock analysis. | Live Replay and voiceover are not available through the existing Edge Function. |
| Edge Function proxies FastAPI | Browser only talks to Supabase for analysis. | Still requires public FastAPI backend and Edge Function maintenance. |

## Media and Runtime Notes

- OpenCV and FFmpeg-related packages can require larger deployment images.
- `imageio-ffmpeg` provides the FFmpeg binary used by voiceover export.
- Video download endpoints must be reachable from the backend network.
- Very large videos increase memory, storage, processing time, and OpenAI cost.

## Production Security Checklist

- Do not expose `OPENAI_API_KEY` to the frontend.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY` to the frontend.
- Replace demo public RLS policies before handling private user data.
- Use HTTPS for `VITE_BACKEND_URL`.
- Restrict `CORS_ORIGINS` to real frontend domains.
- Add authentication and clip ownership before multi-user production use.
- Consider queueing long-running analysis jobs instead of keeping request/response processing for large videos.

## Deployment Smoke Tests

Backend:

```bash
curl https://api.example.com/health
```

Frontend:

- Load `/`.
- Confirm Supabase environment is detected.
- Upload a short clip.
- Run analysis.

Direct backend features:

- Confirm `VITE_BACKEND_URL` points to HTTPS backend.
- Try voiceover export.
- Open `/live` and confirm teams load.

Edge Function:

- Invoke `process-video` with a test `clip_id` and `file_url`.
- Confirm rows appear in `detections`, `retrieved_context`, and `commentaries`.
