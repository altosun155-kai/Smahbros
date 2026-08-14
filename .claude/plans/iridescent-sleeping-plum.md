# Phase 5 (core loop) — Multi-device draft

## Context

The 6-phase roadmap's Phase 5 is a real-time character draft: several players on separate devices join a shared room, each picks characters from their own ranked list, then results reveal together and hand off into a bracket. Phase 4 (this session, already shipped) set up the Next.js scaffold specifically so this could be built as real React — this is the first feature to actually use it.

Two decisions were confirmed with the user before designing this:
- **Realtime transport**: reuse the existing `ws_manager.py` WebSocket system (already authenticated via this app's own JWT, already proven for the tournament lobby socket) instead of Supabase Realtime. Research confirmed this codebase has **zero** existing Supabase Realtime/Auth/RLS/anon-key usage — Supabase today is purely the Postgres host + a public image bucket — so "real" Supabase Realtime would mean designing a brand-new auth boundary from scratch, and the user agreed that's the riskier path, not the safe one.
- **Scope**: this round builds the core loop only — schema, room lifecycle endpoints, realtime wiring, Lobby, Character Select, Waiting state. Reveal, the GSAP Flip transition into the bracket, result-reporting/undo, and haptics are deferred to a follow-up round; the schema (`status: revealed`) leaves the hook point they'll attach to.

This plan went through two review rounds with the user; all corrections are incorporated below rather than left as an appendix:

**Round 1:**
1. **`chars_per_player` is per player, not a room total.** Valid values are **1, 4, or 8** — how many characters *each* player drafts. With 4 fixed players that's 4/16/32 picks total, which is fine — it also drives the deferred reveal round's per-player cluster shape (each player's own corner shows 1 portrait / a 2×2 / a 2×4 depending on their own `chars_per_player`).
2. **Room discovery was missing.** Added `GET /draft/rooms/active`.
3. **No unlock existed.** Added `POST /draft/rooms/{id}/unlock`, blocked once `revealed`.
4. **The self-join endpoint was a mutating `GET`.** Split into read-only `GET /draft/rooms/{id}` and explicit `POST /draft/rooms/{id}/join`.
5. **Concurrent locks were a race.** Resolved with `SELECT ... FOR UPDATE` on the room row inside the lock handler.
6. **Nav**: no new emoji, no 6th bottom-nav tab. Resolved by making "Play" a chooser between 1v1 Duel and Draft.

**Round 2:**
7. **No schema link from a draft room to the bracket it produces.** Added `DraftRoom.bracket_id` now (nullable, set by the deferred round) — free in this migration, avoids a second one later, and is what the already-defined `live` status implies exists.
8. **Duplicate character picks across a player's own slots** — decided **allowed by design**, not a gap: the roadmap's own Flip-transition text says 8-character drafts use "per-slot pools" rendered as "8 separate 4-entry brackets" — each slot is effectively an independent bracket, so the same character appearing in two of a player's slots isn't nonsensical the way it would be in a single flat roster. No uniqueness constraint on `(room_id, player_id, character)`, and the character-select rail does not grey out already-picked characters.
9. **Stale lobbies would pile up in `/active` forever** — no expiry, no close, no leave existed. Fixed with a 6-hour `created_at` filter on `/active` (cheap floor) plus an explicit `POST /draft/rooms/{id}/close` for the host, plus auto-closing a host's other abandoned lobby rooms when they start a new one.
10. **`play.html` mixed an emoji card with an SVG card.** Both cards now use inline Lucide SVGs (`swords` for Duel, `dices` for Draft) — consistent, and this is the natural place to start the icon migration since the page doesn't exist yet.
11. **Lobby/Waiting screens hardcoded "4 avatar tiles."** Both now map over `room.num_players` so an 8-player variant later is a config change, not a component rewrite.

Other implementation-detail calls, unchanged from the first pass:
- **4 players, fixed at creation** (not user-configurable) — the roadmap's Lobby text says "four avatar slots" with no branching. `num_players` is still a real column so an 8-player variant isn't blocked later.
- **Start requires ≥2 players**, not exactly 4 — no stated minimum, just stops a solo "draft" from being startable.
- **WS broadcasts are always masked** — nobody's unlocked character is visible to anyone but themselves, not even their own second device in real time. Only REST responses (per-request/per-user) ever reveal your own in-progress selection, since `ws_manager.push()` is one broadcast per room with no per-viewer filtering and we're not modifying `ws_manager.py`.
- **Single dynamic route** `/draft/[roomId]` that switches view based on `room.status`, rather than three separate URLs — keeps the WebSocket connection alive across phase transitions.

## 1. Schema — `database.py` + `migrations.py`

```python
class DraftRoom(Base):
    __tablename__ = "draft_rooms"
    id               = Column(Integer, primary_key=True, index=True)
    host_id          = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    status           = Column(String, default="lobby", nullable=False)   # lobby / picking / revealed / live / closed
    num_players      = Column(Integer, default=4, nullable=False)
    chars_per_player = Column(Integer, default=1, nullable=False)        # 1, 4, or 8 — picks per PLAYER, not room total
    players          = Column(JSON, default=list)                       # ordered [user_id, ...] = join order
    bracket_id       = Column(Integer, ForeignKey("brackets.id"), nullable=True, index=True)  # set by the deferred reveal/handoff round
    created_at       = Column(DateTime, default=_now)
    host    = relationship("User")
    bracket = relationship("Bracket")

class DraftPick(Base):
    __tablename__ = "draft_picks"
    __table_args__ = (UniqueConstraint('room_id', 'player_id', 'slot_index', name='uq_dp_room_player_slot'),)
    id         = Column(Integer, primary_key=True, index=True)
    room_id    = Column(Integer, ForeignKey("draft_rooms.id"), nullable=False, index=True)
    player_id  = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    slot_index = Column(Integer, nullable=False)
    character  = Column(String, nullable=True)
    locked_at  = Column(DateTime, nullable=True)
    room   = relationship("DraftRoom")
    player = relationship("User")
```

No uniqueness constraint on `(room_id, player_id, character)` — duplicates across a player's own slots are allowed by design (§ decision 8 above). `players` as a JSON list on the parent row matches the existing `Bracket.players` convention. Any in-place mutation of `room.players` needs `flag_modified(room, "players")`.

`migrations.py`: add both tables (including `bracket_id`) to the Postgres branch (`CREATE TABLE IF NOT EXISTS`, `SERIAL PRIMARY KEY`, `JSONB`, `bracket_id INTEGER REFERENCES brackets(id)`) and the SQLite branch (existence check via `sqlite_master`, `INTEGER PRIMARY KEY AUTOINCREMENT`), following the `character_matchups`/`tournament_presets` template already in that file. Add an `idx_dp_room_id` index on `draft_picks(room_id)`.

## 2. `routers/draft.py` (new) + `api.py` wiring

Same shape as `routers/brackets.py` (no `prefix=`, full paths, `Depends(get_db)`/`Depends(get_current_user)`).

**`draft_room_to_dict(db, room, viewer_id)`** — mirrors `bracket_to_dict`. `viewer_id=None` → fully masked, safe for WS broadcast. `viewer_id=<uid>` → that user's own picks unmasked; everyone else's stay masked unless `room.status == "revealed"`.

Endpoints — every mutation commits, then `ws_manager.push(f"draft:{room.id}", draft_room_to_dict(db, room, viewer_id=None))`:

- `POST /draft/rooms` — body `{chars_per_player: 1|4|8}`; creates room, `host_id=current_user.id`, `players=[current_user.id]`, `status="lobby"`. Returns `{"id": room.id}`.
- `GET /draft/rooms/active` — rooms where `status=="lobby"`, `len(players) < num_players`, **and `created_at > now() - 6h`** (stops abandoned rooms accumulating forever), ordered `created_at desc`; each entry has `id`, `host_username`, `player_count`, `num_players`.
- `GET /draft/rooms/{room_id}` — **read-only.** 403 if `current_user.id` not already in `room.players`. Returns the dict unmasked for the caller. No auto-join — a link preview, prefetch, or browser retry must never silently add someone to a room.
- `POST /draft/rooms/{room_id}/join` — the self-service join, moved out of `GET`: if caller isn't already in `players`, room is `"lobby"`, and there's an open slot, append them. 403 if not joinable. Returns the dict unmasked for the caller.
- `POST /draft/rooms/{room_id}/start` — host-only, requires `status=="lobby"` and `len(players)>=2`; flips this room to `"picking"`; **also marks any other `lobby`-status rooms owned by this same host as `"closed"`** (cleans up abandoned "Start a draft" attempts the host walked away from); pushes.
- `POST /draft/rooms/{room_id}/close` — host-only, requires `status=="lobby"` (this is for abandoning a room before it starts, not ending an in-progress pick); sets `status="closed"`; pushes so anyone who'd already joined sees it and can bail out (frontend shows "this draft was closed by the host" rather than erroring).
- `PUT /draft/rooms/{room_id}/pick` — body `{slot_index, character}`; requires `status=="picking"`, caller in `players`, valid unlocked slot (`0 <= slot_index < chars_per_player`); upserts the pick (duplicates across a player's own slots allowed, see decision 8), pushes the masked broadcast, returns the **unmasked** dict directly to the caller — the only place their own in-progress character is ever visible anywhere.
- `POST /draft/rooms/{room_id}/unlock` — body `{slot_index}`; only while `status=="picking"` (403 once `"revealed"` — a late unlock must never un-reveal the room out from under everyone); clears `locked_at`; pushes.
- `POST /draft/rooms/{room_id}/lock` — body `{slot_index}`; requires an existing unlocked pick; re-fetches the room row with **`db.query(DraftRoom).filter(DraftRoom.id==room_id).with_for_update().first()`** before evaluating "is everyone now fully locked," serializing concurrent lock calls so two simultaneous locks can't both flip status (Postgres row-locks; SQLite ignores the clause harmlessly since it already serializes writes at the file level). Sets `locked_at`; if every player has every slot locked, flips `status="revealed"` (the hook point the deferred reveal round attaches to, alongside `bracket_id`). Pushes, returns unmasked dict to caller.

`api.py`: import `DraftRoom`, `draft` router, `draft_room_to_dict`; `app.include_router(draft.router)`; add `/ws/draft/{room_id}`, mirroring `ws_tournament` (accept → 5s token frame → `decode_token` → close 1008 if invalid → look up room, check `user_id in (room.players or [])` → send masked initial snapshot → `ws_manager.connect(key, ws)` where **`key = f"draft:{room_id}"`**, a string deliberately namespaced apart from the tournament socket's bare-int keys in the same shared `ws_manager._rooms` dict → drain pings → `ws_manager.disconnect` on close).

## 3. `web/app/lib/api.ts` + `web/app/lib/chars.ts` (new)

`api.ts` — TS port of `web/public/js/api.js` (`apiGet/apiPost/apiPut/apiPatch/apiDelete`, same 502-retry/backoff, same toast-on-wakeup reusing the existing `#toast-container`/`.toast-*` CSS classes) plus token helpers from `auth.js` (`getToken`/`getUsername`/`clearToken`). `API_BASE` stays the same hardcoded literal used everywhere else. Adds `wsUrl(path)`, converting `API_BASE`'s `http(s)` to `ws(s)`.

`chars.ts` — byte-identical logic port of `web/public/js/chars.js` (`charImgUrl`, `charHeadUrl`, `SMASH_ROSTER`, both override maps verbatim).

## 4. `web/app/lib/useDraftRoom.ts` (new)

Owns the realtime lifecycle: `refetch()` (REST `GET /draft/rooms/{id}`, called on mount and on `visibilitychange` wake per the roadmap's explicit "don't trust the socket" instruction) plus a `WebSocket` connection (`onopen` sends the JWT as first frame; `onmessage` merges incoming masked state while preserving the caller's own already-known unlocked picks). Returns `{room, error, refetch, myId, notJoined}` — `notJoined` set when the initial `GET` 403s, so the page shows a "Join this draft" prompt instead of silently failing.

## 5. Screens under `web/app/draft/`

- `web/app/draft/page.tsx` — a `chars_per_player` toggle with **three** options (1 / 4 / 8) + "Start a draft" → `POST /draft/rooms` → redirect to `/draft/{id}`. Also calls `GET /draft/rooms/active` on mount (plus a light ~8s poll — no dedicated lobby-discovery socket this round) and renders a banner per open room ("kai started a draft — Join"); Join calls `POST /draft/rooms/{id}/join` then routes to `/draft/{id}`.
- `web/app/draft/[roomId]/page.tsx` — calls `useDraftRoom`. If `notJoined`, shows a "Join this draft" button instead of auto-adding. If `room.status === "closed"`, shows "this draft was closed by the host." Otherwise branches on `room.status` + whether the current user is fully locked: `lobby` → `DraftLobby`; `picking` + not fully locked → `DraftCharacterSelect`; `picking` + fully locked, or `revealed` → `DraftWaiting`.
- `DraftLobby.tsx` — avatar slots mapped over **`room.num_players`** (not hardcoded 4) from `room.players` (padded with empties), host badge, "Start" button (host-only, ≥2 players), "Close" option (host-only).
- `DraftCharacterSelect.tsx` — 3-panel layout: rail = `GET /characters/favorites` (ordered list — confirmed this, not `CharacterRanking`, is what `favorites.html` actually populates) falling back to top-10-by-Elo from `GET /characters/stats` when empty; center = full-bleed portrait via `charImgUrl`; right = stat rows using the existing `.num`/`--font-mono` convention from `leaderboard.html`. Picking a rail item calls `PUT .../pick` immediately (character comes from that REST response). Sticky "Lock in" reuses `.sticky-bar`, calls `POST .../lock`; a locked slot shows an "Unlock" affordance calling `POST .../unlock`. No greying-out of already-picked characters (duplicates allowed, decision 8). Mobile (`@media max-width:700px`): portrait fills top 55% of viewport, rail becomes a horizontal snap strip reusing `index.html`'s `.qs-scroll`/`.qs-card` classes verbatim, stats collapse to a new small `.draft-stats-grid` (2×2), Lock in stays sticky.
- `DraftWaiting.tsx` — avatar tiles mapped over **`room.num_players`**, lock-icon badge per player once all their slots show `locked: true` — never renders a character.

New draft-specific CSS (avatar grid, lock badge, 3-panel select layout, `.draft-stats-grid`) appends to the existing global `web/public/css/style.css` (already imported once in `layout.tsx`), `draft-` prefixed.

## 6. Nav — "Play" becomes a chooser

The mobile bottom nav is already at its five-tab ceiling (Home/Play/Rankings/Stats/Profile) per the roadmap's own "delete the drawer, everything fits under five tabs" goal — Draft can't just be a 6th icon, and no new emoji either.

- **New `web/public/play.html`** (vanilla page, standard `auth.js`+`requireAuth()`+`nav-inject.js` includes): two cards — "1v1 Duel" → `duel.html` using an inline Lucide `swords` SVG, and "Draft" → `/draft` using an inline Lucide `dices` SVG. Both cards use the same icon treatment (no emoji/SVG mismatch) — this is the natural starting point for migrating off emoji icons generally, though that migration itself stays scoped to this new page, not retrofitted onto existing pages. Reuses existing `.card`/`.btn`/`.btn-primary` classes.
- `nav-inject.js` bottom nav: the "Play" tab's `href` changes from `duel.html` to `play.html`; its `playPages` active-state array gains `'play.html'` so the tab stays highlighted through the hub, mid-duel, and mid-tournament-setup. Label unchanged ("Play"); icon unchanged (still broadly correct since Duel is still one of its two destinations, and this tab isn't part of the emoji migration in this round).
- Desktop sidebar `NAV` array (`Compete` section): new flat entry `{ href: '/draft', label: 'Draft', icon: <inline Lucide dices SVG> }` alongside Bracket/1v1 Duel/My Brackets — desktop has no tab-count ceiling, so it skips the chooser and lists Draft directly.
- `web/app/layout.tsx` gets a minimal back-link (not a full nav port — separate task) so `/draft` isn't a dead end for users who land there directly.

## Verification

1. Backend: `python3 -m py_compile` on every touched `.py` file; import `api.py` in the disposable venv (SECRET_KEY/DATABASE_URL env vars, scratch SQLite) and confirm `draft` routes register in `app.routes`.
2. Live exercise via `uvicorn` + a raw HTTP/WS client script: create 3+ users; confirm a room is visible to others via `GET /draft/rooms/active` and disappears once full or closed; confirm `GET /draft/rooms/{id}` 403s for a non-member and never auto-adds; join via explicit `POST .../join`; host starts (confirm any other abandoned lobby room from that host flips to `closed`); all players pick (including a deliberate duplicate-character pick across one player's own slots, confirming it's accepted); lock; confirm unlock works mid-picking and is rejected after `revealed`; confirm `status` flips to `revealed` only once even when two lock calls race for the last two slots (fire concurrently, assert exactly one `revealed` transition/broadcast); confirm the masked dict never leaks an un-revealed opponent's character; confirm a WS push follows every mutation.
3. Frontend: `npm run build` in `web/` to confirm the new TSX/TS compiles; Playwright pass with two browser contexts walking discover-via-active-list → join → lobby → select (including picking a duplicate character across two of the same player's slots when `chars_per_player > 1`) → lock → unlock → re-lock, confirming the waiting screen shows lock icons without leaking characters, and confirming a `visibilitychange` refetch pulls current state. Confirm `play.html` renders both cards (both SVG, no emoji) and routes correctly, and that the bottom nav's Play tab highlights on `play.html`, `duel.html`, and `tournament.html`.
4. Confirm zero regressions on existing vanilla pages beyond the nav/play.html changes.
5. Nothing committed or pushed — stays with the user per standing convention.
