# Remove Practice, and hide test accounts from every listing/picker

## Context

Two separate cleanups: (1) delete the Practice feature entirely, and (2) make sure a real (non-test) user can never see a test account (`testuser1`-`testuser4`, marked by `User.is_test`) anywhere on the site — leaderboards, mastery boards, player pickers, search, badges, team-battle standings, presets. So far `is_test` is only respected by `GET /auth/users` and `GET /users/connections`; two Explore passes confirmed at least a dozen other endpoints leak test accounts into lists a real user sees.

### Practice — fully isolated, clean deletion
- `database.py:50` `User.practice_sessions` relationship, `database.py:129` `CharacterStats.practice_elo` column (separate from the real `CharacterStats.elo`), `database.py:135-150` `PracticeSession` model.
- `routers/practice.py` (277 lines) — self-contained elo/placement logic, zero imports to/from `routers/matches.py` or any other router. Confirmed via repo-wide grep: `PracticeSession`/`practice_elo` appear only in `database.py`, `api.py`, `routers/practice.py`.
- `api.py:13` (import), `api.py:63,77-78,177-182` (migrations: table creation + 2 `ADD COLUMN`s, Postgres and SQLite branches), `api.py:248` (`include_router`).
- `web/practice.html` (919-line standalone page, all styling inline). `web/js/nav-inject.js:19` sidebar entry (Practice was never in the mobile bottom-nav). Confirmed via grep: no other page references "practice" at all.

### Test-account visibility — one pattern, many call sites
Every leaking endpoint falls into one of two shapes, and the fix is the same one-line addition in each case — **unconditionally exclude `is_test` users from these public/shared listings**, regardless of who's viewing (simpler and safer than making previously-public endpoints viewer-aware; test accounts have no legitimate reason to appear on the real leaderboard/pickers for anyone). This does *not* touch `GET /users/connections` or `/characters/mastery/connections`, which correctly stay viewer-relative (that's the one place "test accounts see only test accounts" actually matters).

**Shape A — queries `User` directly**: add `.filter(User.is_test == False)` to the query.
- `routers/leaderboard.py` `GET /leaderboard` (the `db.query(User).filter(User.id.in_(stats.keys()))` line) and `GET /leaderboard/h2h-matrix` (the `db.query(User.id, User.username).filter(User.id.in_(user_ids))` line — this alone also scrubs test accounts out of the matrix itself, since the existing `if w and l:` guard already skips any pairing where a username lookup misses).
- `routers/users.py:61` `/users/all`, `routers/users.py:96` `/users/badges/all` (`all_users_list`), `routers/users.py:341` `/users/search`.

**Shape B — queries `CharacterStats`/`MatchResult`/`Bracket`/`TournamentPreset` and reads a `.owner`/`.winner`/`.loser`/`.creator` relationship**: add a one-line skip/filter keyed off that relationship's `.is_test`.
- `routers/characters.py` — `/characters/mastery` (skip `row.owner.is_test` in the loop), `/characters/stats/leaderboard`, `/characters/stats/leaderboard/kills`, `/characters/stats/leaderboard/winpct`, `/characters/stats/leaderboard/elo` (same pattern, or add `.join(User, CharacterStats.user_id == User.id).filter(User.is_test == False)` to the query — either works, query-level join is preferred since it's one extra clause vs. a loop-body `continue`). `/characters/user-averages` (line ~312, `user = stats[0].owner` — add `if user.is_test: continue` right after).
- `routers/matches.py:114-141` `/matches/shame` — filter the final list comprehension to `for r in rows if not r.winner.is_test and not r.loser.is_test`.
- `routers/brackets.py:138-146` `/brackets/team-battles` — filter `if not b.owner.is_test` when building the returned list.
- `routers/presets.py:49-52` `/presets` — filter `if not p.creator.is_test` when building the returned list.

**Frontend — no changes needed for most pages.** `web/duel.html`, `web/teams-bracket.html`, `web/tier-list.html`, and `web/stats.html` all populate their player pickers from `/users/all`; fixing that one endpoint server-side clears test accounts out of all four pickers for free. Same for `web/profile.html`/`web/invites.html`'s autocomplete, both backed by `/users/search`. `web/bracket.html`/`web/tournament.html`'s `/users/all` usage is just an avatar-lookup cache, already harmless either way.

**Explicitly out of scope**: single-username lookups where the caller already knows/types the exact name (`/users/{username}/profile`, `/h2h/{other}`, `/activity`, `/comments`, `/stats`, `/badges`, `/characters/ranking/{username}`, `/characters/favorites/{username}`, `/characters/stats/{username}`). These aren't discovery surfaces — a real user would have to already know a test username to hit them — so they're left alone rather than adding is_test gating to every single-user route in the app.

## Verification

1. Boot the backend locally against a throwaway SQLite copy (same disposable-venv approach used throughout this session).
2. Delete `PracticeSession`/`practice_elo` from `database.py` and confirm the app still boots with no import errors (`api.py`, `routers/leaderboard.py` etc. don't reference them).
3. Confirm `/practice/*` routes 404 and `web/practice.html` is gone with no nav link anywhere.
4. Seed one real account (`Kai`) and one test account (`testuser1`, auto-flagged `is_test` on restart per the existing backfill), plus a `MatchResult` between two *other* real accounts and one involving `testuser1`.
5. Confirm `GET /leaderboard`, `/leaderboard/h2h-matrix`, `/users/all`, `/users/badges/all`, `/users/search?q=test`, `/characters/mastery`, and the four `/characters/stats/leaderboard*` variants all omit `testuser1` entirely.
6. Load `web/duel.html`'s opponent picker in a browser (patched `API_BASE`, as done throughout this session) and confirm `testuser1` doesn't appear as a selectable option.
