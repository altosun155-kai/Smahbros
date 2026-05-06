---
paths:
  - "*.py"
  - "routers/*.py"
---

# Backend Rules (FastAPI / Python)

- New routes always call `decode_token(request)` from `auth.py` for auth.
- DB migrations go in `_run_migrations()` in `api.py` using `ADD COLUMN IF NOT EXISTS` — never create Alembic files.
- All error responses: `JSONResponse(status_code=…, content={"detail": "…"})`.
- Rate-limit auth and write endpoints via `routers/ratelimit.py`.
- `SessionLocal` must be used as a context manager (`with SessionLocal() as db:`).
- PostgreSQL-specific SQL (JSONB, arrays) must be guarded with `if is_pg:` check.
- Never commit `smash.db` — it is local-only SQLite.
- Environment variable for DB: `DATABASE_URL` (patched in `database.py` for `postgres://` → `postgresql://`).
