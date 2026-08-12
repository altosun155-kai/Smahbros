# Remove the friend-request system; make "connection" implicit by account type

## Context

The app currently has a full friend-request system (send/accept/decline/remove, a dedicated Friends page, and a duplicate friends sidebar widget with a notification badge). The user wants this removed entirely and replaced with an implicit rule: every account is automatically "connected" to every other account, except test accounts (`User.is_test`, added earlier this session), which should only be considered connected to other test accounts.

Research (via Explore agent, confirmed against source) found the friend system's *actual* footprint is much smaller than its UI surface suggests:
- **`Friendship` model** (`database.py:152-163`): `requester_id`, `addressee_id`, `status` ("pending"/"accepted"), unique pair constraint `uq_friendship_pair`. `User` has two cascading relationships to it (`database.py:51-52`).
- **`routers/friends.py`**: 6 routes (list friends, list pending requests, send/accept/decline/remove) — all standard `Depends(get_current_user)`.
- **Only two other things ever depended on friendship status**:
  1. `routers/characters.py:162-183` `GET /characters/mastery/friends` — scopes the character-mastery view to `{self} ∪ accepted friends}`.
  2. The "quick add" chip UI in `web/bracket.html:1156-1180` and `web/teams-bracket.html:553-590` — pulls `GET /friends` to autofill the player-list textarea. This is a convenience, not a restriction.
- **Nothing else is gated on friendship.** `routers/invites.py`, `routers/matches.py`, `routers/brackets.py`, `routers/roundrobin.py` already let you reference *any* registered username with zero friend check — confirmed via repo-wide grep. So "every account connected to every account" is already true for actual gameplay; this change is about the two friend-scoped features above, plus deleting the request/accept workflow and its UI.
- Frontend surface to remove: `web/friends.html` (dedicated page), `web/js/friends-sidebar.js` (duplicate panel + notification badge, injected into `bracket.html`, `my-brackets.html`, `tournament.html`), and the "Friends" nav entry in `web/js/nav-inject.js:24`.

## Approach

Replace the `Friendship` table/workflow with a computed rule: **a user's "connections" = every other user with the same `is_test` value.** No new table, no request/accept state — it's just a query (`User.is_test == current_user.is_test`, excluding self). This mirrors the plan from the earlier `is_test` change (same column, same reasoning: real accounts and test accounts should never mix).

### Backend

**`database.py`** — delete the `Friendship` class (lines 152-163) and the two relationships on `User` that reference it (`sent_friend_requests`, `received_friend_requests`, lines 51-52).

**`routers/friends.py`** — delete the file entirely.

**`api.py`**:
- Remove `friends` from the router import (line 13) and `app.include_router(friends.router)` (line 256).
- Remove both `CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_pair ON friendships(...)` lines (lines 63, 182) — the table itself is left alone in the existing production DB (no `DROP TABLE`, consistent with this project's habit of not running destructive migrations), but a *fresh* install should no longer reference a table that's no longer created via `Base.metadata.create_all`.

**`routers/users.py`** — add a new route near `/users/all`:
```python
def _is_active(last_seen) -> bool:
    if not last_seen:
        return False
    return (datetime.utcnow() - last_seen).total_seconds() < 600


@router.get("/users/connections")
def list_connections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    others = db.query(User).filter(
        User.is_test == current_user.is_test,
        User.id != current_user.id,
    ).order_by(User.username).all()
    return [{"id": u.id, "username": u.username, "avatar_url": u.avatar_url, "active": _is_active(u.last_seen)} for u in others]
```
This returns the exact same shape the old `GET /friends` did (`{id, username, avatar_url, active}`), so the two frontend call sites need only a URL change, not a shape change. (`_is_active` is copied verbatim from the deleted `routers/friends.py:12-15`.)

**`routers/characters.py`** — in `character_mastery_friends` (line 162), drop the `Friendship` import/query and the endpoint path itself; replace with a connections-scoped query, renamed to match reality:
```python
@router.get("/characters/mastery/connections")
def character_mastery_connections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    connection_ids = {u.id for u in db.query(User.id).filter(User.is_test == current_user.is_test).all()}
    rows = db.query(CharacterStats).filter(
        CharacterStats.user_id.in_(connection_ids),
        CharacterStats.points > 0,
    ).all()
    ...  # rest of function body unchanged
```
Remove `Friendship` from the `from database import ...` line at the top of the file (it becomes unused).

### Frontend

- **Delete** `web/friends.html` and `web/js/friends-sidebar.js`.
- **`web/js/nav-inject.js:24`** — remove the `{ href: 'friends.html', label: 'Friends', icon: '👥' }` nav entry.
- **`web/bracket.html`, `web/my-brackets.html`, `web/tournament.html`** — remove the `<script src="js/friends-sidebar.js"></script>` include from each.
- **`web/bracket.html`** (~line 313, ~1161) and **`web/teams-bracket.html`** (~line 214, ~582) — in the "quick add" block: change `apiGet('/friends')` → `apiGet('/users/connections')` (both the initial load and, in `teams-bracket.html`, the 30s polling refresh), change the `<h2>Add Friends</h2>` heading to `<h2>Add Players</h2>`, and change the empty-state text ("No friends yet — add some on the Friends page." / "No friends yet.") to something like "No other players yet."
- **`web/mastery.html`** (line 201, 406) — change the fetch call to `/characters/mastery/connections` and soften the copy "Who in your friend circle dominates each character?" → "Who in your circle dominates each character?"

### Files that do NOT change
`routers/invites.py`, `routers/matches.py`, `routers/brackets.py`, `routers/roundrobin.py`, `ws_manager.py`, `auth.py` — none of them ever referenced `Friendship`; player/opponent/invite selection was already open to any username.

## Verification

1. Start the backend locally against a throwaway SQLite copy (same approach as the earlier auth testing this session — disposable venv, never touch the real `smash.db` or hit production).
2. Create two non-test accounts (`Kai`, `Leap`) and one `testuser1` account via `/auth/enter`.
3. `GET /users/connections` as `Kai` → should list `Leap`, not `testuser1`. As `testuser1` → should list nothing (only test account) unless another test account exists.
4. Confirm `routers/friends.py` is gone and the app still boots (`app.include_router(friends.router)` removed cleanly, no import errors).
5. Load `web/bracket.html` and `web/teams-bracket.html` in a browser (patched `API_BASE`, as done earlier this session) — confirm the "Add Players" chip list populates from `/users/connections` and clicking a chip still adds the username to the player textarea.
6. Load `web/mastery.html` — confirm `/characters/mastery/connections` returns data and the page renders without console errors.
7. Confirm `web/friends.html` returns 404/is gone, and no page shows a "Friends" nav link or the old sidebar tab.
