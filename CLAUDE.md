# Smahbros

Smash Bros tournament bracket platform with real-time 1v1 mini-game arena.

## Architecture

| Layer | Tech | Deploy |
|---|---|---|
| Backend API | FastAPI (Python) | Render — `smash-bracket-api.onrender.com` |
| Frontend | Vanilla HTML/CSS/JS | Vercel — `bracket-self.vercel.app` |
| Database | SQLAlchemy → SQLite (local) / PostgreSQL (prod) | Supabase |
| Game engine | Phaser 3 (canvas) over WebSocket | same Render instance |
| Assets | Fighter images | Supabase Storage bucket `Characters` |

## Key Files

```
api.py              — FastAPI app, lifespan startup, _run_migrations(), WebSocket routes
database.py         — All SQLAlchemy models (User, Bracket, TournamentInvite, Match, …)
ws_manager.py       — Tournament lobby WebSocket manager
game_ws_manager.py  — Real-time game room manager (2 players per room)
auth.py             — JWT helpers (HS256, token in localStorage.authToken)
routers/            — One file per resource (auth, brackets, matches, friends, …)
web/js/auth.js      — requireAuth() guard — must be first script on every page
web/js/api.js       — API_BASE constant + fetch wrappers — never hardcode the URL
web/js/nav-inject.js — Injects shared nav bar — never hardcode nav HTML in pages
web/game.html       — Full Phaser game: lobby UI + WebSocket client + scene
```

## Conventions

**Frontend**
- Every page: `<script src="js/auth.js"></script>` then immediately `<script>requireAuth();</script>`
- All API calls go through `API_BASE` from `api.js`
- Nav injected by `nav-inject.js` — no duplicate nav markup
- No build step — plain ES5-compatible JS, no imports

**Backend**
- New DB columns: add `ADD COLUMN IF NOT EXISTS` in `_run_migrations()`, not a new Alembic file
- All routes return JSON; errors use `JSONResponse(status_code=…)`
- Auth middleware extracts JWT via `decode_token()` from `auth.py`
- Rate limiting lives in `routers/ratelimit.py`

**Game**
- Room supports exactly 2 players; server owns physics, client is pure renderer
- Player positions come from server `state` messages — never simulate on client
- Visual layers render order: floor → walls → slashGfx → boomGfx → slimeGfx → HUD

## Gotchas

- Render cold-starts take **~30 s** — lobby shows a "server waking up" message after 4 s
- PostgreSQL prod URL starts `postgres://` but SQLAlchemy needs `postgresql://` — patched in `database.py`
- `smash.db` (SQLite) is local-only; never commit it
- Supabase image URLs use `%20` encoding for spaces in fighter names (e.g. `Donkey%20Kong.png`)
- `playerSlot` is 0-indexed from server; displayed as "Player 1/2" in UI
- WebSocket closes silently on auth failure — check `ws.onclose` for "rejected session" message

## Workflow

```
Plan (Shift+Tab) → implement → test locally → commit → push → Vercel auto-deploys frontend
```
Backend deploys manually via Render dashboard or `render.yaml`.
