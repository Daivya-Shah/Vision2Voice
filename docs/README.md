# Vision2Voice Documentation

This directory is the maintainer-facing documentation for Vision2Voice. It separates setup, architecture, API contracts, data storage, and operational notes so changes can be made in one place without expanding the root README.

## Documentation Map

| Document | Purpose |
| --- | --- |
| [Project Overview](./project-overview.md) | Product scope, major capabilities, repository layout, and common workflows. |
| [Architecture](./architecture.md) | System components, request paths, backend pipeline, live replay pipeline, and data flow. |
| [Local Development](./local-development.md) | Environment setup, install steps, local commands, testing, and day-to-day development notes. |
| [Configuration](./configuration.md) | Frontend, backend, OpenAI, Supabase, media, and live replay environment variables. |
| [API Reference](./api-reference.md) | FastAPI endpoint contracts, request bodies, response shapes, errors, and SSE event types. |
| [Supabase Data Model](./supabase-data-model.md) | Tables, storage bucket, Edge Function behavior, persistence rules, and RLS posture. |
| [Live Replay](./live-replay.md) | How the simulated-live workflow works, required inputs, event reconciliation, and operational limits. |
| [Deployment](./deployment.md) | Production deployment patterns for the frontend, backend, Supabase Edge Function, and secrets. |
| [Troubleshooting](./troubleshooting.md) | Common failure modes and concrete checks. |

## Quick Start

For local full-stack development:

```bash
npm install
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
npm run dev:full
```

Required configuration is split between root `.env` for Vite and `backend/.env` for Python. See [Configuration](./configuration.md).

## Primary User Flows

1. Upload a basketball clip on `/`.
2. Store the video in Supabase Storage.
3. Analyze through either the direct FastAPI path or the Supabase Edge Function path.
4. Show structured event detection, retrieved basketball context, timeline-aligned commentary, and optional voiceover export.
5. Use `/live` to run a replay file against NBA play-by-play as a simulated live caption stream.

## Maintenance Rules

- Keep public setup instructions in the root `README.md` concise.
- Put detailed implementation and operational notes in this directory.
- Update [API Reference](./api-reference.md) whenever request or response fields change.
- Update [Supabase Data Model](./supabase-data-model.md) whenever migrations or Edge Function persistence behavior changes.
- Update [Configuration](./configuration.md) whenever an environment variable is added, removed, or changes behavior.
