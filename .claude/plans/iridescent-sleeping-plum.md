# Frictionless auth: replace password login with "pick a name"

## Context

Smahbros is currently deployed for a private group of 4 friends. The user wants to drop the login friction. A full removal of auth was ruled out because `User.id`/JWT identity is load-bearing for friends, invites, matches, and bracket ownership (`get_current_user` is used across nearly every router). The agreed direction instead: keep the existing JWT identity model, but let someone log in by just typing a name — no password, and no separate signup step. Everything downstream of "a valid JWT exists" (`get_current_user`, WebSocket auth, friends/invites lookups by username) stays untouched; only how the token gets minted changes.

Verified against the live source (not assumptions):
- `auth.py` — `make_token(user_id)`, `decode_token(token)`, `get_current_user` (reads `Authorization: Bearer …` header) all only care about `user_id`; none of them touch passwords. `hash_password`/`verify_password` (lines 30-35) wrap werkzeug's hasher and are used only by `routers/auth.py`.
- `routers/auth.py` — `POST /auth/register` (needs username≥3, password≥8, uniqueness) and `POST /auth/login` (verifies password) are the *only* callers of `hash_password`/`verify_password`, and the only routes `web/login.html` calls.
- `database.py` `User` model — `hashed_password` is `String, nullable=False`. No email/other identity column. `username` is the only unique constraint.
- `web/login.html` — tabbed Sign In / Sign Up form calling `/auth/login` and `/auth/register` respectively, storing the returned token via `setToken`/`setUsername` from `web/js/auth.js`.
- `web/js/auth.js` (`requireAuth`, `isLoggedIn`, `setToken`) and `web/js/api.js` (`apiFetch`, 401 handling) have zero knowledge of how a token was minted — no changes needed there.
- Every other router (`matches.py`, `friends.py`, `invites.py`, `roundrobin.py`, `presets.py`, `users.py`, `brackets.py`, `practice.py`, `characters.py`) depends on `get_current_user`, unaffected by this change. `friends.py`/`invites.py` resolve other users purely by `username` string, so nothing there needs to change either.
- Aside (not in scope): `game_ws_manager.py`, listed in `CLAUDE.md` as a key file, was deleted in commit `8d097f1` ("reset") and no longer exists in the tree. Unrelated to this change — not touched or resurrected here.

## Approach

Replace `/auth/register` + `/auth/login` with a single **`POST /auth/enter`**: given a username, log in if it exists, create it on the spot if it doesn't. This avoids any DB migration — `hashed_password` stays `NOT NULL` and gets satisfied with a random per-user placeholder hash that's never checked again (`verify_password` becomes unused dead code, left in place).

### `routers/auth.py` — replace both routes with one

```python
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import User
from auth import get_db, hash_password, make_token
from routers.ratelimit import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])


class EnterRequest(BaseModel):
    username: str


@router.post("/enter")
def enter(req: EnterRequest, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, max_req=10, window=60)

    name = req.username.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a name")
    if len(name) > 24:
        raise HTTPException(status_code=400, detail="Name is too long")

    user = db.query(User).filter(func.lower(User.username) == name.lower()).first()
    if not user:
        user = User(username=name, hashed_password=hash_password(secrets.token_urlsafe(24)))
        db.add(user)
        db.commit()
        db.refresh(user)

    return {"token": make_token(user.id), "username": user.username}
```

Notes:
- Case-insensitive username match (`func.lower`) so "Kai"/"kai" resolve to one account; stored casing is whatever was typed first.
- Rate limit kept at the old login's `10/60s` via the existing `rate_limit` helper from `routers/ratelimit.py`.
- A same-instant race between two different capitalizations of one name creating two rows is a theoretical edge case, accepted as low-stakes for a 4-person app (not engineered around).

### `web/login.html` — one field, no tabs

Replace the `.auth-tabs` + `#panelSignin`/`#panelSignup` markup (lines 23-97) with a single form: one "Your name" text input (`maxlength="24"`, `autocomplete="username"`), one submit button.

Replace the two submit listeners (`signinForm`, `signupForm`, lines 148-240) with one handler that calls `apiFetch('POST', '/auth/enter', { username }, false)`, then `setToken`/`setUsername` and redirect to `loginReturnUrl || 'index.html'` — same pattern as the current sign-in handler, just one fewer field and one endpoint.

Retarget `waitForServer()`/`setServerReady()` (lines 104-136) to the single new button instead of `signinBtn`/`signupBtn`. Delete `switchTab()` (no tabs left). Leave `web/css/auth.css`'s now-unused `.auth-tabs`/`.auth-tab-btn` rules in place — dead CSS, zero risk, not worth touching.

`redirectIfLoggedIn()` at the top of the page and everything in `js/auth.js`/`js/api.js` stay exactly as-is.

### Files that do NOT change
`auth.py`, `web/js/auth.js`, `web/js/api.js`, `database.py`, `api.py`'s `_run_migrations()`, every router besides `routers/auth.py`, and all WebSocket auth (`api.py`'s tournament WS handshake, `ws_manager.py`).

## Verification

1. Run the backend locally (`uvicorn api:app --reload`) against local `smash.db`.
2. Open `web/login.html`, type a brand-new name, submit — confirm a new `User` row is created, a token is returned, and you land on `index.html` fully authenticated (nav shows username, `requireAuth()`-gated pages load).
3. Log out, re-enter the same name (try a different case, e.g. "KAI" vs "kai") — confirm it logs into the *same* account (same `user.id`, same friends/matches/brackets visible), not a duplicate.
4. Confirm an existing pre-migration account (created via the old password flow, if any exist in the DB) can still log in through `/auth/enter` with just its username.
5. Hit `/auth/enter` >10 times in 60s and confirm the existing rate-limit response still triggers.
6. Spot-check one downstream authenticated flow (e.g. sending a friend request) still works unchanged, confirming `get_current_user` didn't need touching.
