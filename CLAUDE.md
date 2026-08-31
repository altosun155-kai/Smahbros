# Smahbros

Smash Bros tournament bracket platform.

## Architecture

| Layer | Tech | Deploy |
|---|---|---|
| Backend API | FastAPI (Python) | Render — `smash-bracket-api.onrender.com` |
| Frontend | Next.js 16 / React 19 (migration in progress) over legacy Vanilla HTML/CSS/JS | Vercel — `bracket-self.vercel.app` |
| Database | SQLAlchemy → SQLite (local) / PostgreSQL (prod) | Supabase |
| Assets | Fighter images | Supabase Storage bucket `Characters` |

`web/app/*` is the Next.js frontend being migrated *to*; `web/public/*` is the legacy vanilla frontend being migrated *from*. Both are currently live and both are currently deployed — routes not yet ported in `web/app` fall through to the static `web/public` pages.

## Key Files

```
api.py              — FastAPI app, lifespan startup, _run_migrations(), WebSocket routes
database.py         — All SQLAlchemy models (User, Bracket, TournamentInvite, Match, …)
ws_manager.py       — WebSocket room manager for live tournament + draft-room pushes
                       (routers/draft.py's ws_manager.push, /ws/tournament/{id} in api.py)
auth.py             — JWT helpers (HS256, token in localStorage.authToken)
routers/            — One file per resource (auth, brackets, matches, friends, …)
web/app/lib/api.ts  — Canonical API client for the Next.js app — typed port of web/public/js/api.js
web/public/js/auth.js      — requireAuth() guard — must be first script on every legacy page
web/public/js/api.js       — API_BASE constant + fetch wrappers — never hardcode the URL
web/public/js/nav-inject.js — Injects shared nav bar — never hardcode nav HTML in legacy pages
```

## Conventions

**Frontend**
- Legacy (`web/public/*`) pages: every page loads `<script src="js/auth.js"></script>` then immediately `<script>requireAuth();</script>`; all API calls go through `API_BASE` from `api.js`; nav injected by `nav-inject.js` — no duplicate nav markup; no build step, plain ES5-compatible JS, no imports.
- `requireAuth()` is the legacy pattern — it's still correct and required on every un-migrated page, but new Next.js pages get their own React auth-guard equivalent instead (planned, not yet built) rather than porting `requireAuth()` literally.
- All API calls from `web/app/*` go through `web/app/lib/api.ts`, not a reimplementation.

**Backend**
- New DB columns: add `ADD COLUMN IF NOT EXISTS` in `_run_migrations()`, not a new Alembic file
- All routes return JSON; errors use `JSONResponse(status_code=…)`
- Auth middleware extracts JWT via `decode_token()` from `auth.py`
- Rate limiting lives in `routers/ratelimit.py`

## Gotchas

- Render cold-starts take **~30 s** — lobby shows a "server waking up" message after 4 s
- PostgreSQL prod URL starts `postgres://` but SQLAlchemy needs `postgresql://` — patched in `database.py`
- `smash.db` (SQLite) is local-only; never commit it
- Supabase image URLs use `%20` encoding for spaces in fighter names (e.g. `Donkey%20Kong.png`)

## Known Gaps

- **Manual "send an invite" flow was specced but never wired up.** `web/public/invites.html`'s JS has complete logic for searching a user and sending them a tournament invite (`searchUsers`/`selectInvitee`/`sendInvite`), but the HTML form those functions target was never added to the page — it's dead code, unreachable from the live UI. Today, invites are only ever created automatically when starting a live tournament from the Bracket page (`POST /invites` is called from there, not from `invites.html`). The Next.js port (`web/app/invites`) intentionally dropped the dead JS rather than porting unreachable code or building the missing UI. Decide separately whether a manual send flow is actually wanted — with a small group already in the same room, the automatic path from Bracket may be the only one that's ever needed, in which case dropping it was permanent, not just deferred.
- **Duels have no actual series-end.** `web/public/duel.html` has "Series Winner" banner markup and a `seriesWinner` guard, but nothing in the file ever sets `seriesWinner` truthy — a duel is really just an open-ended running score (`p1Score`/`p2Score` tallied per recorded game) with a manual "New Series" reset, not a best-of-N that concludes on its own. The Next.js port (`web/app/duel`) reproduces exactly that: no series-end detection, no winner banner. This is a real feature decision waiting, not lost knowledge — and it's bigger than "add first-to-3 logic" once it comes up: 2-player draft rooms may end up routed into the duel flow as a series (chars-per-player is already 1/4/8 there), in which case series length should come from the draft, not be hardcoded on the duel page. Decide once that shape is clearer.
- **`POST /matches/record` 403s for every non-admin user when called from the Duel page — confirmed live, not theoretical.** `routers/matches.py:154` requires either `current_user.is_admin` or a `bracket_id` tied to a bracket the caller hosts. `web/public/duel.html`'s `recordGame()` never sends `bracket_id` (a 1v1 duel isn't tied to any bracket), so today, clicking a score button on the Duel page only works if the user happens to be an admin — everyone else gets a silent toast error. Verified by spinning up a scratch backend, creating a fresh non-admin user (the only kind `/auth/enter` ever creates), and reproducing the exact 403. Scope checked and narrow: `bracket.html` and `tournament.html` also call `/matches/record` but both correctly pass `bracket_id` (they're already bracket-scoped) — this hole is specific to the standalone Duel page, doesn't affect the draft/tournament result-recording path. The Next.js port (`web/app/duel`) reproduces the exact same call (still 403s for non-admins) rather than fixing it inline — fix as its own task.

## Workflow

```
Plan (Shift+Tab) → implement → test locally → commit → push → Vercel auto-deploys frontend
```
Backend deploys manually via Render dashboard or `render.yaml`.

## Working Conventions

- **Plan before building, wait for approval.** For anything nontrivial, propose the approach and get a go-ahead before writing code — don't start implementing off an assumed plan.
- **Never commit or push without being asked.** Land changes in the working tree and stop there; committing/pushing is a separate, explicit request every time, not a default step at the end of a task.
- **Don't touch files outside the task's scope.** If something adjacent looks broken or worth improving, mention it — don't fix it inline unless asked.
- **Verify changes rather than assuming they worked.** Spin up the app locally and actually exercise the change (Playwright, curl, or both) before calling something done — don't rely on the code "looking right." If a claimed bug doesn't reproduce, say so plainly instead of making a cosmetic edit to look productive.
- **Ask instead of guessing when a spec is ambiguous.** If the request's own description of current behavior doesn't match what the code actually does, surface that mismatch explicitly rather than silently picking a side.

**Patterns worth keeping in mind, noticed over the course of this repo:**
- Precise, detailed specs are the norm here (ordered pipelines, numbered guard lists, exact reproduction steps) — match that precision, including the edge cases named, not just the headline behavior.
- A recurring class of bug in this codebase is duplicated constants/thresholds drifting apart (provisional-game cutoffs, API base URLs, etc.) — when fixing one instance, it's worth grepping for sibling copies of the same number/logic elsewhere.
- Shared state driving multiple independent surfaces (one checkbox controlling two tables, one endpoint serving two callers with different needs) is a repeat root cause here — prefer decoupling over a shared flag when two consumers' needs might diverge.
- Local verification convention: scratch SQLite DB per feature (`smash_test_<name>.db`), a throwaway `SECRET_KEY`, backend on port 8850 / frontend on 8851, `next.config.js`'s API rewrite and any `WS_ORIGIN`/`API_BASE` constants temporarily pointed at `127.0.0.1:8850` for the test, then reverted to the real production URLs before wrapping up — and the scratch DB and servers torn down (by exact PID, not a name-based kill) at the end.
- Report findings straight — including "this doesn't reproduce" — rather than shaping the story to look done.
