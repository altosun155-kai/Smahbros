# Home page redesign — cinematic menu, champion background, one-call summary

## Context

The current home page (`web/public/index.html`, ~900 lines) has grown into six overlapping sections — Quick Start presets, three mode cards, two Play cards, and three secondary-link grids (Rankings / History & Stats / Customize) — nearly all of which duplicate navigation that already exists in the sidebar and mobile bottom nav (`web/public/js/nav-inject.js`). This round replaces it with a cinematic three-column menu (reference: an Assassin's Creed-style main menu) built around a champion's character render as background art, a hover-driven detail panel, and one aggregate backend call instead of the current page's half-dozen scattered fetches.

**Resolved decisions** (asked directly, not assumed):
- **Continue's empty state**: when there's no in-progress tournament/draft, *New tournament* is promoted into the highlighted top slot instead of Continue — and the detail panel, when that slot is highlighted (including on load, since it's the default), shows the most recently **completed** session's result as a fallback ("last session: Friday night s3 — leap won, 3 days ago"). This needs one extra cheap query in the summary endpoint, not a second system.
- **Vanilla JS, not React.** Nothing in steps 4–7 requires React — crossfade, parallax, and keyboard nav are all plain-JS techniques already used elsewhere in this codebase. Porting `nav-inject.js` to a shared React layout component stays deferred; scoping it in here would roughly double this task's size and risk for no benefit to the actual redesign.
- **Team Battle stays out of the menu.** It doesn't exist in the codebase — `web/teams-bracket.html` and `web/team-standings.html` were built, linked, and fully deleted (code + nav entries) in one same-day commit. Including it means rebuilding a deleted feature from scratch, which is out of scope here.

**Champion definition** (per your note, both current and any future surface should share one helper): the #1 player by **`User.elo`** (`database.py:41`, exposed today as `player_elo` in `/leaderboard`'s response) — not the win-rate-sorted order `/leaderboard` uses for its own ranking. New helper `_get_champion(db)` in `routers/leaderboard.py`: top `User.elo` among non-test users, then that player's most-played character via `CharacterStats` (highest `wins+losses`, tie-broken by `elo` — same derivation this session already used once for the login shatter, which is why it belongs in a shared, reusable place rather than inline in a new endpoint).

**A gap worth flagging**: step 6 says the secondary nav list can be dropped on mobile because "those are all tabs already." Checked — the mobile bottom nav (`nav-inject.js:49-55`) only has Home/Play/Rankings/Stats/Profile. Mastery, Tier List, and Favorites are *not* in it — today they're only reachable on mobile via the very Rankings/Customize cards this redesign removes. Dropping them with no replacement would make those three pages unreachable on mobile. Fix folded into Step 6: add Mastery, Tier List, and Favorites to `nav-inject.js`'s mobile bottom nav as a compact overflow (or extend the row) rather than silently dropping them.

## Step 1 — Delete (do this first, verify in isolation)

From `web/public/index.html`, remove:
- **Quick Start section** (markup lines 448-453, `#homePresetsSection`) and its backing JS: `loadHomePresets()`, `_renderWhoRow()`, `_renderPresetCards()`, `homeClickPlayer`, `homelaunchPreset`, and the `_dimmedPlayers`/`_presetsData`/`_playerTopChars` state (lines ~798-898). CSS: `.qs-*` rules (lines 158-201).
- **Play cards** (lines 455-474, `.primary-grid`/`.primary-card`) — CSS lines 85-97 (desktop) and 302-319 (mobile), including the dead unused `.rr` (round-robin) variant.
- **Rankings / History & Stats / Customize** (lines 480-523, three `.secondary-grid` blocks) — CSS lines 100-106 (desktop) and 322-327 (mobile).

Leave completely untouched in this step (their restructuring happens in Step 4, as part of the new layout, not here): the hero card (`#heroCard`, lines 377-415) and Latest Intel (`#squadAlerts` + `loadSquadAlerts()`, lines 477-478 / 688-739) — except trim Latest Intel's render to its first 3 items (`.slice(0, 3)` on the `/matches/shame` response) since the new right column only holds 3 posters.

This is a self-contained, revertible cleanup pass with no new dependencies — verify the page still loads, hero card and a 3-poster Latest Intel still render, and no console errors from the removed functions' now-dangling `onclick` references, before moving to Step 2.

## Step 2 — Palette (token edit, site-wide effect)

`style.css`'s `:root` currently defines only two color accents: `--accent-blue: #0077c8` (17 usages — general UI chrome: links, nav active-state, buttons, focus rings, spinners) and `--accent-gold: #f5a623` (5 usages, already the warm/orange tone — used today for Elo displays). Win/loss green/red are **not tokenized** — they're ~13 scattered hardcoded hex literals (`#e74c3c`, `#27ae60`/`#4ade80`) across `style.css` and `index.html`'s inline styles.

- Keep `--accent-gold` as the single kept UI accent (it's already the wordmark's warm tone).
- `--accent-blue`'s 17 UI-chrome call sites become neutral — reuse existing `--text-muted`/`--border`/`--card-bg2` tokens rather than inventing a new one, since this codebase already has a full neutral palette.
- Add two new tokens, `--accent-pos: #27ae60` and `--accent-neg: #e74c3c`, and repoint every hardcoded win/loss/positive/negative hex literal at them.

**This is genuinely site-wide** (`style.css` is shared by every page), not scoped to the home page alone — flagging explicitly since it's a bigger visual footprint than the rest of this task. That's the intended reading of "the layout won't read as cinematic until yours is too."

## Step 3 — `GET /home/summary` (new `routers/home.py`)

One aggregate call, auth via `get_current_user` per this repo's convention (`.claude/rules/backend.md`). Response:
```json
{
  "in_progress": {"type": "bracket"|"draft", "id", "name", "round_or_progress", "leader", "started_at"} | null,
  "last_session": {"name", "winner", "ended_at"} | null,
  "last_duel": {"opponent", "result", "record", "played_at"} | null,
  "champion": {"username", "character", "player_elo"},
  "mastery_coverage": {"played", "total", "pct"},
  "posters": [ ...3 items, same shape /matches/shame already returns... ]
}
```
Reuse points (nothing here gets reinvented):
- **`in_progress`**: union of owned live brackets (`Bracket.user_id==me, is_live=True`) + accepted-invite live brackets (exact query already in `routers/brackets.py:169-181`, `/brackets/live`) + draft rooms containing the user (`DraftRoom.players` JSON contains `current_user.id`, `status` in `lobby`/`picking`/`live`) — most recent by timestamp wins. For a bracket's "round", reuse `_compute_round_participants()` (`routers/brackets.py:19-39`) to find the highest round with an unresolved match; "leader" is the bracket host (`b.owner.username`) — a pragmatic stand-in, since "current front-runner mid-bracket" isn't an existing concept to invent one for. For a draft room, `round_or_progress` is lock progress (e.g. `"3/4 locked"`) and leader is the room host.
- **`last_session`** (only computed when `in_progress` is null, per the resolved decision — one extra query, not a new system): most recently *ended* bracket among owned+accepted-invite brackets (`is_live=False`, order by end/created timestamp desc, limit 1), winner via the existing `_infer_winner()` (`routers/brackets.py:77-94`).
- **`last_duel`**: one new query — most recent `MatchResult` where the user is winner or loser (`order_by(created_at.desc()).limit(1)`), then two small `count()` queries for the head-to-head record against that specific opponent. Do **not** reuse `/leaderboard/h2h-matrix` wholesale (`routers/leaderboard.py:88-116`) — that computes every pair and would be wasteful for a single lookup; its grouped-query pattern is the thing worth mirroring, not the endpoint itself.
- **`champion`**: the new `_get_champion(db)` helper described in Context.
- **`mastery_coverage`**: new per-user query — distinct characters in `current_user`'s `CharacterStats` with games > 0, divided by total roster size. During implementation, source the roster-size constant from wherever `routers/characters.py`'s existing `character_mastery` endpoint (`characters.py:146-167`) already gets it — don't hardcode a second copy of the roster count.
- **`posters`**: same underlying query `GET /matches/shame` uses (`routers/matches.py:124-151`), called directly (not as an internal HTTP request to itself), limited to 3.

## Step 4 — Desktop layout

Rebuild `index.html`'s `<main>` into a three-column grid over a full-bleed background:
- **Left**: primary group (Continue-or-New-tournament, 1v1 duel) — highlighted item bordered+filled; secondary group below as flat hairline rows (Leaderboard, Mastery, Tier List, Favorites, Profile, Sign out — same destinations already in `nav-inject.js`'s NAV array, presented as compact rows instead of cards).
- **Middle**: the detail panel (Step 5), top-anchored, rest of the column left empty.
- **Right**: 3 poster cards from `/home/summary`'s `posters`, reusing the existing `.bounty-poster`/`.tombstone-poster` CSS (`style.css:1336-1503`) already shared across pages — same visual style, just relocated and endpoint-driven instead of a direct `/matches/shame` fetch.
- **Background**: `charImgUrl(champion.character)` (`web/public/js/chars.js`, already the sitewide portrait-URL helper) as a full-bleed image, `filter: brightness(0.3)`, right-anchored, with a gradient-mask overlay fading to near-black toward the left so the menu column sits over it cleanly.

## Step 5 — Detail panel

Default content = Continue/New-tournament's summary on load (matching whichever is the highlighted top slot per Step Context). Hover **or** focus on any menu item — primary or secondary — swaps the panel: last duel for 1v1, champion for Leaderboard, coverage for Mastery, etc. Content crossfades via opacity at ~150ms; the panel itself has a fixed min-height so it never reflows as content length changes across items. Keyboard nav (arrow keys move the highlight across the unified primary+secondary list, Enter activates) reuses the same focus-driven state the hover behavior already needs, so it's a small addition once hover/focus swapping exists.

## Step 6 — Mobile

Drop the secondary hairline list; extend `nav-inject.js`'s mobile bottom nav with Mastery/Tier List/Favorites (see the gap noted in Context) so nothing becomes unreachable. Mobile home becomes four elements: darkened background (same champion art/filter, no parallax), a Continue/New-tournament card with context baked directly into the card body (no hover state on mobile, so the last-session fallback text needs to always render there when relevant), New tournament and 1v1 duel as full-width rows, and the poster strip with `scroll-snap-type: x` — reuse the exact snap-strip technique already built this session for `.draft-bracket-carousel` (`web/public/css/style.css`, added during the draft reveal work).

## Step 7 — Motion

Menu item hover fills background color only (no `transform: scale`). Menu items stagger in on page load via incremental `animation-delay` per item (40ms), same vocabulary as this session's other stagger work, just CSS instead of GSAP since there's no shared-element morph involved. Background parallax (2-3% translate following mouse position) is desktop-only, gated the same way this codebase already detects mobile elsewhere (`window.innerWidth <= 700`), throttled via `requestAnimationFrame`. Everything here respects `prefers-reduced-motion` — same established convention as the rest of this codebase (skip parallax and stagger entirely, land in final state immediately).

## Verification

1. Step 1 verified in isolation first (see above) before any of steps 2-7 begin — gives a real revert point independent of the new design work.
2. Local exercise via the established sed-`API_BASE`-and-revert + Playwright pattern: at 390px and desktop width, confirm the menu never overlaps the background's focal point, the detail panel's bounding box doesn't change across different highlighted items, Continue's empty state (fresh seeded account, zero brackets/drafts/matches) correctly promotes New tournament and shows no phantom Continue, and the champion background falls back gracefully when `/leaderboard` is empty (same empty-DB test pattern already used for the login shatter's fallback check).
3. Confirm the `/home/summary` fetch is gated behind the same `/health` cold-start poll as `login.html`'s `waitForServer()` (`web/public/login.html:76-89`) — adapted/copied into the home page's own script, since that function is page-local today, not a shared module.
4. Confirm nothing on any other page broke from Step 2's site-wide token changes — spot-check a handful of other pages (nav, buttons, a win/loss badge) still render sensibly.
5. Nothing committed or pushed — stays with you per standing convention.
