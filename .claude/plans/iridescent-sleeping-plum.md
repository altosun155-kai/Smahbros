# Phase 5 (remainder) — Reveal, Flip transition, bracket handoff, undo, haptics

## Context

The draft's core loop (schema, room lifecycle, WebSocket, Lobby/CharacterSelect/Waiting screens, tier-list-aware rail fallback) is already built and shipped this session. What's left from the original roadmap: a Reveal screen, a GSAP "Flip transition" into a live tournament bracket, result reporting with a 30-second undo, and haptics.

**Architecture decision**: rather than rebuilding bracket rendering, match recording, and undo in React, **React only builds the Reveal screen, the Flip transition, and a compact "landed" bracket preview** — then hands off via a plain link (`tournament.html?id={bracketId}`) to the existing, mature, already-working vanilla `tournament.html` page for all ongoing match play. Research confirmed `tournament.html`'s renderer is deep, tested, working code (imperative HTML rebuild, SVG connector measurement, a full VS-modal recording flow, existing GSAP winner-flash/elo-count-up/connector-draw-in) — duplicating it in React would be expensive and risky for no benefit. This is the same "reuse over rebuild" call this session already made once (Phase 5's core loop reusing `ws_manager.py` over Supabase Realtime).

**Bracket schema has no concept of "multiple independent brackets in one row"** — confirmed by reading `computeRounds()`/`_compute_round_participants()`, both treat `bracket_data` as one merged elimination tree. Since the draft's (already-corrected) `chars_per_player` means "picks per player" (1/4/8), each of a room's `chars_per_player` slots becomes its **own independent `Bracket` row** — exactly matching the roadmap's "8 characters → 8 separate 4-entry brackets." `DraftRoom` already shipped with a single nullable `bracket_id` FK (a hook point that can't reference N brackets) — per this codebase's "never drop/retype columns" convention, this round adds a new `bracket_ids` JSON column alongside it and leaves `bracket_id` unused.

**Bracket creation is folded directly into the already-tested `lock_draft_pick()` transition**, immediately after the existing `with_for_update()` race-guarded "is everyone locked" check (that guard logic is untouched). Status goes `picking` → `live` in one request — no client ever observes a separate lingering `revealed` broadcast, matching the roadmap's "all four phones buzz at the same instant." Round-1 pairing for the new brackets is **deliberately simple: join order, not elo-seeded** (`bracket-engine.js`'s seeding logic is client-side JS, not reusable from Python, and porting its full seed-mode complexity isn't warranted here) — a stated simplification, not a silent gap. With `num_players` fixed at 4 and `start` requiring ≥2, joined-player count is always 2–4, so round-1 is always 1 or 2 pairs — never an odd count to worry about.

**Auth scope**: "anyone reports a result" was confirmed scoped to draft-originated brackets only (regular host-created tournaments keep today's owner-only restriction). Implementing this correctly touches **three** call sites, not one — `tournament.html`'s recording flow calls `POST /matches/record` (Elo) *and* `PATCH /brackets/{id}/winner` (bracket advancement) together, and `DELETE /brackets/{id}/result/{match_key}` is the undo path — all three are owner-only today. Relaxing only the first would update Elo but leave the bracket UI stuck (403 on advancement) for any non-host draft participant — a worse outcome than not building this at all. All three get the identical extension: allowed if the requester owns the bracket, **or** the bracket is one of a `DraftRoom.bracket_ids` and the requester is one of that room's joined players. This is completing the already-approved draft-only boundary correctly, not widening it — non-draft brackets are completely unaffected.

**A real CSS gap found**: `.draft-avatar-empty`'s "slow breathing pulse" was never actually implemented (no `animation` property exists) — this round adds it for real.

## 1. Schema — `bracket_ids` column

`database.py` — add one column to the already-shipped `DraftRoom` model (leave `bracket_id` as-is):
```python
bracket_ids = Column(JSON, default=list)   # ordered [bracket_id, ...], len == chars_per_player, set atomically at picking -> live
```

`migrations.py` — since `draft_rooms` has an explicit `CREATE TABLE IF NOT EXISTS` (not just `ADD COLUMN`), add `bracket_ids` to both branches' `CREATE TABLE` blocks *and* add a follow-up idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (Postgres) / `PRAGMA table_info` guard (SQLite) immediately after, matching this file's existing belt-and-suspenders style for tables that already exist in prod.

`routers/draft.py`'s `draft_room_to_dict()`: add `"bracket_ids": room.bracket_ids or []`. `web/app/lib/useDraftRoom.ts`'s `DraftRoomState`: add `bracket_ids: number[]`.

## 2. Bracket creation, folded into `lock_draft_pick()`

`routers/draft.py` — import `Bracket`. New helpers:
- `_pair_players_join_order(usernames)` — pairs `[0]v[1], [2]v[3], ...`, lone trailing player gets a bye (`None`).
- `_build_slot_bracket(pairs, picks_by_username)` — returns `(bracket_data, entries)` for one slot: `bracket_data` is `[{a, b}]` with `"{player} — {character}"` labels (`"BYE"` for byes, matching `_parse_label()`'s existing pipe-format parsing in `brackets.py`), `entries` is `[{player, character}]` skipping byes.
- `_create_draft_brackets_and_go_live(db, room, pick_rows)` — for each of `room.chars_per_player` slots, builds that slot's bracket via the helpers above, creates a `Bracket(user_id=room.host_id, name=f"Draft #{room.id}" + (" — Slot N" if >1 slot), mode="draft", is_live=True, chars_per_player=1, ...)`, `db.flush()`s to get its id, collects `bracket_ids`. Sets `room.bracket_ids` (+ `flag_modified`) and `room.status = "live"`.

Inside `lock_draft_pick()`, right where `everyone_locked` is already computed under the existing `with_for_update()` guard: call `_create_draft_brackets_and_go_live(db, room, all_rows)` instead of setting `status = "revealed"` directly, then `db.commit()`.

`draft_room_to_dict()`'s unmask condition extends from `room.status == "revealed"` to `room.status in ("revealed", "live")`.

## 3. Auth relaxation (3 call sites) + `can_record` surfaced to the client

`routers/matches.py` — new helper (plain Python scan, no JSONB-containment SQL — this app is small-scale):
```python
def _bracket_is_draft_accessible(db, bracket_id, user) -> bool:
    if not bracket_id:
        return False
    rooms = db.query(DraftRoom).filter(DraftRoom.bracket_ids.isnot(None)).all()
    return any(bracket_id in (r.bracket_ids or []) and user.id in (r.players or []) for r in rooms)
```
`record_match()`'s existing owner-only check becomes `is_owner or _bracket_is_draft_accessible(db, req.bracket_id, current_user)`.

`routers/brackets.py` — `set_bracket_winner` and `undo_result_by_key` get the identical `is_owner or _bracket_is_draft_accessible(...)` swap (lazy-imported from `routers.matches`, matching this file's existing pattern for avoiding circular imports). `undo_last_result` (the non-keyed, "most recent globally" undo) is left owner-only — its UI call site is being replaced in §5 anyway.

`bracket_to_dict()` gains optional `viewer`/`db` params; when passed, adds `d["can_record"] = viewer.is_admin or is_owner or _bracket_is_draft_accessible(db, b.id, viewer)`. `get_bracket()`'s call site passes `viewer=current_user, db=db`. The `/ws/tournament/{id}` handler's `bracket_to_dict(b)` call is left as-is (that socket is never actually opened by `tournament.html`, which polls via REST — confirmed by reading it — so `can_record` simply won't be present there, harmlessly unused).

## 4. React: Reveal, Flip transition, landed bracket preview

`web/package.json` — add `"gsap": "^3.13.0"` to `dependencies` (matches the 3.x line already CDN-loaded on the vanilla pages), `npm install` inside `web/`.

`web/app/lib/haptics.ts` (new) — direct port of `duel.html`'s existing pattern:
```typescript
export function haptic(pattern: number | number[] = [10]): void {
  try { navigator.vibrate?.(pattern); } catch {}
}
```

`web/app/draft/[roomId]/page.tsx` — new branch: `room.status === 'live'` → `<DraftReveal room={room} />` (before the fallback `DraftWaiting`, which still harmlessly covers the transient/unreachable `'revealed'` state).

`web/app/draft/[roomId]/DraftReveal.tsx` (new) — two-phase:
- **Reveal phase**: `room.num_players` corner slots (mapping over the count, matching the existing `DraftLobby`/`DraftWaiting` convention — not hardcoded 4), each showing avatar+username and that player's locked picks clustered inboard (`draft-reveal-picks-1/4/8` grid variants based on `chars_per_player`, portraits via `charImgUrl()`). Empty player slots render the (now-fixed) `.draft-avatar-empty` pulse. `useEffect` fires `haptic()` once on mount.
- After a ~1.5–2s pause (timer-driven, not tap-to-continue — keeps the moment synchronized across devices rather than desyncing on individual taps), triggers the Flip: `Flip.getState()` on `[data-flip-id]` portrait nodes, toggle a wrapper class that switches layout from corner-grid to bracket-preview positions **without unmounting the portrait DOM nodes** (Flip needs the same elements to animate from/to), then `Flip.from(state, { duration, ease: 'power2.inOut', stagger: { each: 0.04, grid: 'auto', from: 'start' }, ... })` honoring the roadmap's specified stagger — **200ms between player clusters, 40ms between characters within a cluster** (implemented as a per-cluster base delay plus GSAP's intra-cluster stagger). Guarded by `window.matchMedia('(prefers-reduced-motion: reduce)').matches` — falls back to an instant class-swap with no tween, since the existing CSS `prefers-reduced-motion` override can't reach JS-driven GSAP tweens (same gap noted during the earlier visual-overhaul round).
- Renders `<DraftBracketPreview room={room} />` for the bracket phase.

`web/app/draft/[roomId]/DraftBracketPreview.tsx` (new) — one panel per `room.bracket_ids` entry. `chars_per_player === 1` → single panel, no carousel. 4/8 → horizontal `scroll-snap-type: x mandatory` carousel reusing the same snap-strip pattern already established for `.draft-rail` (hidden scrollbar, `scroll-padding-inline`). Each panel shows round-1 pairs only (no click-to-score, no connectors — that's `tournament.html`'s job) plus `<a className="btn btn-primary" href={`/tournament.html?id=${bracketId}`}>Open Bracket {n}</a>`.

CSS — new `draft-` prefixed classes in `web/public/css/style.css` (not a reuse of `tournament.html`'s inline `.round-col`/`.match-box`, which live in that page's own `<style>` block and aren't available to the Next bundle — duplicating them risks the tested vanilla page for no benefit; new classes echo the same tokens `--card-bg2`/`--border`/`--radius` instead): `.draft-reveal-grid`, `.draft-reveal-corner`, `.draft-reveal-picks-1/4/8`, `.draft-bracket-carousel`, `.draft-bracket-panel`, `.draft-bracket-match`, `.draft-bracket-entry`. Plus the actual pulse fix:
```css
@keyframes draftBreathe { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
.draft-avatar-empty { animation: draftBreathe 2.4s ease-in-out infinite; }
```
(already covered by the existing shared `prefers-reduced-motion` CSS override, no extra work needed there).

## 5. Vanilla: 30-second keyed undo in `tournament.html`

Upgrades the existing generic "undo the most recent result" bar to a **per-match, time-boxed** one — also a correctness fix: with §3's relaxed auth, two different draft participants recording matches in quick succession would otherwise let one accidentally undo the other's unrelated result via the old "most recent globally" endpoint. Switching to the already-existing keyed `DELETE /brackets/{id}/result/{match_key}` endpoint fixes that regardless.

- `#undoBar` markup gets a countdown span next to the label and its button.
- New `showUndoBtn(label, matchKey)` (gated on the new `canRecord` client-side flag): starts a 1s `setInterval` countdown display plus a 30s `setTimeout` that hides the bar, keyed to the specific `matchKey` just recorded.
- `undoLastScore()` rewritten to call the keyed endpoint with the stored `matchKey` instead of the old un-keyed "last result" endpoint.
- `pickTournamentScore()`'s call site passes the specific match's label + key to `showUndoBtn`.
- New `let canRecord = false;` set from `data.can_record` in `fetchAndRender()` (falls back to `false`/host-only if the API hasn't redeployed yet, since the field would just be `undefined`). Every UI gate that currently checks `isHost` **for the recording controls specifically** (score-pick buttons, VS-modal pointer-events/view-only state, mobile-card click handler, undo bar) swaps to `canRecord`. Every `isHost` gate for **host administration** (end tournament, share/invite bar, lineup/bracket generation) is left untouched — those stay host-exclusive.

## Verification

1. Backend: `python3 -m py_compile` on every touched file; live `uvicorn` exercise extending the existing draft test script — run a room through to full-lock, confirm `chars_per_player` `Bracket` rows are created with correct `entries`/`bracket_data` (including a 3-player room to confirm the bye pairs correctly), confirm `DraftRoom.bracket_ids` is populated and `status` reads `live` with no observable intermediate `revealed` push, confirm a non-host draft participant can successfully call `POST /matches/record`, `PATCH /brackets/{id}/winner`, and `DELETE /brackets/{id}/result/{key}` on a draft-originated bracket, and confirm those same calls still 403 for a non-host on a regular (non-draft) bracket — the scope boundary must hold.
2. Frontend: `npm run build` in `web/` to confirm the new TSX compiles and `gsap`/`gsap/Flip` resolve; Playwright pass driving a room through to `live`, confirming the Reveal grid renders (including an empty-slot pulse for a 2-3 player room), the Flip transition completes without throwing, the bracket preview carousel shows one panel per `chars_per_player`, and each panel's link correctly opens `tournament.html?id=...`. Separately verify `tournament.html`'s new undo countdown against a draft-originated bracket (record → undo within 30s succeeds, confirm the countdown UI, confirm it targets the correct `match_key` when two different matches are recorded back to back) and confirm `prefers-reduced-motion` collapses the Flip to an instant swap.
3. Confirm zero regressions on the existing, non-draft bracket/tournament flow — an owner-created regular tournament's recording/undo/host-admin behavior must be byte-identical to before.
4. Nothing committed or pushed — stays with the user per standing convention.
