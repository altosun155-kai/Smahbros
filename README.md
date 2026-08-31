# Smahbros

Smash Bros tournament bracket platform.

## Project structure

```
Smahbros/
├── api.py              ← FastAPI app entrypoint (lifespan startup, migrations, WebSocket routes)
├── database.py          ← SQLAlchemy models
├── auth.py               ← JWT auth helpers
├── routers/              ← One file per API resource (auth, brackets, matches, draft, …)
├── migrations.py         ← _run_migrations() — ADD COLUMN IF NOT EXISTS style, no Alembic
└── web/                  ← Frontend (Next.js 16 / React 19)
    ├── app/               ← Next.js app being migrated *to* — routes, components, lib/api.ts
    └── public/            ← Legacy vanilla HTML/CSS/JS pages being migrated *from*
                              (still live; served statically alongside web/app)
```

See `CLAUDE.md` for the fuller architecture/conventions reference.

## Deployment

| Layer | Where |
|---|---|
| Backend API (`api.py`) | Render — `smash-bracket-api.onrender.com` |
| Frontend (`web/`) | Vercel — `bracket-self.vercel.app` |
| Database | Supabase (PostgreSQL) in prod, SQLite locally |
| Character images | Supabase Storage bucket `Characters` |

Backend deploys manually via the Render dashboard or `render.yaml`. Frontend auto-deploys on push via Vercel.

## Local development

### Backend

```bash
pip install -r requirements.txt
SECRET_KEY=<any-string> DATABASE_URL=sqlite:///./smash.db uvicorn api:app --reload --port 8850
```

`DATABASE_URL` defaults to `sqlite:///./smash.db` if unset. Never commit that file — it's local-only.

### Frontend

```bash
cd web
npm install
npm run dev -- -p 8851
```

For a fully isolated local stack (scratch DB, ports 8850/8851, temporarily re-pointing `API_BASE`/`WS_ORIGIN` at `127.0.0.1:8850` instead of production) see the Working Conventions section in `CLAUDE.md` — this is the pattern used to verify every change before it's called done.

## Environment variables

| Variable | Where | Notes |
|---|---|---|
| `SECRET_KEY` | backend | JWT signing key |
| `DATABASE_URL` | backend | `postgresql://…` in prod (Supabase), `sqlite:///./smash.db` locally |
