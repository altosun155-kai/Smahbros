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
- **`POST /matches/record` 403s for every non-admin user whenever the call isn't tied to a live bracket — confirmed live on both Duel and (manual) Bracket, not theoretical.** `routers/matches.py:154` requires either `current_user.is_admin` or a `bracket_id` tied to a bracket the caller hosts. `web/public/duel.html`'s `recordGame()` never sends `bracket_id` at all (a 1v1 duel isn't tied to any bracket), so clicking a score button there only works for admins. **Correction to this entry's original scope claim** ("bracket.html... correctly pass bracket_id"): that's only true *after* a live tournament has been started from that page — `bracket.html`'s `recordMatchResult()` sends `bracket_id: liveTournamentId || null`, and `liveTournamentId` stays `null` for the page's default, more common flow (build a bracket manually, score it via the VS modal or winner-select dropdown, only start it live afterward if at all). Reproduced live during the Next.js bracket-page port: generated a 2-player manual bracket as a fresh non-admin user, scored all 3 matches (R1 ×2 + Grand Final) through the VS modal, all 3 `/matches/record` calls 403'd — round winners/scores/Elo-preview/connector-lines/champion-banner all still worked client-side (the call is wrapped in try/catch, same as Duel), but no Elo/kills/wins were actually saved server-side. `tournament.html` is unaffected — every match there is inherently tied to an already-live bracket, so `bracket_id` is always real. The Next.js ports (`web/app/duel`, `web/app/bracket`) both reproduce the exact same calls (still 403 for non-admins in the same conditions) rather than fixing inline — fix as its own task, and when it lands, fix both call sites (Duel's missing `bracket_id` entirely, and Bracket's `null` case for not-yet-live brackets) together since they're the same root cause.
- **User-average leaderboard's weighted/simple toggle was never wired up.** `web/public/leaderboard.html` has a `setAvgMode('weighted'|'simple')` function and CSS for `.avg-toggle-btns`, but no actual `<button>` elements exist anywhere in the HTML to call it — `avgMode` is permanently stuck at `'weighted'`. The Next.js port (`web/app/leaderboard`) always renders the weighted average and drops the dead toggle function, matching what's actually reachable today.
- **`game-menu.js`'s overlay mode isn't ported — `AppShell`'s "Menu" button is still a no-op on every migrated page.** `web/public/js/game-menu.js` is one shared module with two modes: `'page'` (the cinematic 3-column menu — champion background, detail panel, bounty posters — that *is* `index.html`, now ported as `web/app/page.tsx`) and `'overlay'` (the same menu in a dismissible dialog behind every other legacy page's hamburger "Menu" trigger, with backdrop-click/Escape-to-close and focus trapping). Only `'page'` mode was ported. `AppShell.tsx`'s `openGameMenu()` still guards on `typeof window.GameMenu !== 'undefined'` and no-ops, exactly as it did before this page existed — clicking "Menu" on `/draft`, `/login`, or any other migrated page does nothing. Port overlay mode as its own task, sharing the panel-content/poster/menu-item rendering already written for `web/app/page.tsx` rather than re-deriving it, and wire it into `AppShell`'s existing trigger.
- **`tournament.html`'s VS score modal has a detail panel (`#desktopScoreGrid` — the per-scenario rank-arrow + Elo table with `score-preset-btn` buttons) that is dead in every viewport, not just desktop despite the name.** It starts `display:none` inline and nothing ever un-hides it: on desktop/landscape there's no CSS rule overriding the inline style, and on portrait mobile `style.css`'s `@media (max-width: 600px) and (orientation: portrait)` block explicitly forces it `display:none !important` too (that same block is what shows its sibling, `#mobileScorePicker`, the winner-first card picker — which *is* live, on portrait phones only). So on desktop, scoring only ever happens through the compact `.vcp-btn` 3-0/3-1/3-2 buttons in the center panel (with hover Elo preview) — the detailed grid was never reachable. The Next.js port (`web/app/tournament`) drops `#desktopScoreGrid`'s markup entirely and keeps only the compact center-panel buttons (desktop) + `#mobileScorePicker` (portrait mobile, same id so the existing media-query CSS keeps applying unchanged). Decide separately whether desktop should actually get a detailed rank/Elo grid — if so it needs real show/hide CSS, not just porting the dead markup as-is.
- **`bracket.html`'s entry-grid character auto-fill has never actually worked.** `buildEntryGrid()`/`getEntryPoints()`/the Save-Preset default-population code all read `document.querySelector('input[name="fillMode"]:checked')` to decide whether to auto-fill each player's characters by Elo/Kills/Win%/Favorites/Tier-list — but no `<input name="fillMode">` radio group exists anywhere in the page's HTML (unlike `bracketStyle`/`seedMode`, which really are rendered by `bracket-options.js`'s `renderBracketOptions()`). The query always returns `undefined`, so `fillMode` always falls back to each call site's own default — `'points'` in `buildEntryGrid()`, which matches none of the real branches — so every character picker in the entry grid starts empty; players have always had to hand-pick every character. `getEntryPoints()` is fully dead code, never called from anywhere. The Next.js port (`web/app/bracket`) reproduces this: entry grid ports as manual-pick-only, `getEntryPoints()` is dropped. Decide separately whether a real fill-mode selector is worth building — the 5 branches (elo/kills/winpct/favorites/tierlist) it would drive already exist and work, they've just never had a control wired to them.

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
