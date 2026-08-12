# Mobile UX — priority items 1-4

## Context

A mobile design review came back blunt: "there is no mobile version — there's a desktop site being viewed on a phone." The review ends with an explicit priority list; per the user's own framing ("Do 1–4 and it stops feeling like a website on a phone. Do the rest and it's an app."), this round scopes to exactly items 1-4. Items 5-9 and the aesthetic long-tail are deferred to a follow-up round.

Research (2 Explore passes) found each of these 4 items maps to a concrete, well-understood root cause:

1. **No manifest/standalone mode** — confirmed zero PWA setup anywhere: no `manifest.json`, no `apple-mobile-web-app-*` meta tags on any of the 15 `web/*.html` pages, and `web/img/` is empty (no icon asset exists yet).

2. **Two nav systems fighting each other, not one being deleted** — there are actually **three** nav surfaces: the sidebar (`web/js/nav-inject.js`, 13 links), a hamburger dropdown (`web/js/nav.js`, entirely separate, rebuilds its own link list from the sidebar's `<a>` tags), and the 5-item bottom bar (also from `nav-inject.js`). Worse, there's a real breakpoint bug: `.nav-links` hides and `.hamburger-btn` appears at `@media (max-width: 768px)` (`web/css/style.css:767-794`), but `#bottomNav` only appears at `@media (max-width: 700px)` (`style.css:247-260`). **Viewports 701-768px wide get the hamburger with no bottom bar; viewports ≤700px get both simultaneously.** `web/js/nav.js` (48 lines) is *entirely* hamburger logic — nothing else lives in that file, so it can be deleted outright rather than edited.

3. **The two remaining broken tables already have a working sibling to copy** — `web/leaderboard.html`'s "User Avg Stats" table already has a complete, working mobile card fallback (`#avgCardList`, swapped in via `@media (max-width: 700px) { #avgTableWrap{display:none!important} #avgCardList{display:block} }`, `style.css` lines ~150-158, cards styled at lines 112-148). The other two tables on the same page — `#charTable` (Character Stats, 10 columns, paginated+sortable, feeds `openEloHist` row-click) and `#globalTable` (Global, 8 columns incl. badge pills) — have no such fallback, which is exactly the "Joker row stacking 3/6 across three lines" and clipped-header complaint. Both live inside their own wrapper divs (`#charTableWrap`, `#globalTableWrap`) with the exact sibling-div slot already implied by the avg pattern.

4. **The primary action isn't unstyled, it's mispositioned** — `web/bracket.html:362-366` and `web/teams-bracket.html:258-260` *already* wrap "Generate Bracket" in a `.sticky-bar` div, but that class is `position: sticky` (not `fixed`) and duplicated verbatim inline in each page's own `<style>` block (`bracket.html:36`, `teams-bracket.html:64`) — never promoted to `style.css`. Since it's the last element in a scrolling column, `position: sticky` never actually engages until you're nearly at the true bottom of the page — it behaves like static positioning, which is exactly the "requires the longest scroll on the page" complaint. `web/duel.html`'s "Start Series" button (`duel.html:229`) has no sticky wrapper at all and needs one added, per the review calling it out by name ("Same pattern on Start Series").

## Approach

### 1. Manifest + standalone mode
- Generate three PNG icons via a small one-off Python/Pillow script (Pillow confirmed available) — dark background (`#0f0f17`, matching `--bg`) with the app's blue accent (`#0077c8`) — saved to `web/img/icon-192.png`, `web/img/icon-512.png`, `web/img/apple-touch-icon.png` (180×180).
- Add `web/manifest.json`: `name`/`short_name` "SmashBros", `display: "standalone"`, `background_color`/`theme_color` matching `--bg`, icon entries.
- Add to every page's `<head>` (all 15 files, same 3-4 lines each, matching this codebase's existing per-page-duplication convention rather than inventing a shared include): `<link rel="manifest" href="manifest.json">`, `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, `<link rel="apple-touch-icon" href="img/apple-touch-icon.png">`, `<meta name="theme-color" content="#0f0f17">`.

### 2. Delete the hamburger; unify the breakpoint
- Delete `web/js/nav.js` outright (confirmed to contain nothing but hamburger logic).
- Remove its `<script src="js/nav.js"></script>` include from all 14 pages that have it.
- Remove `.hamburger-btn`/`.nav-dropdown` rule blocks from `style.css` (lines ~721-764).
- Change the `@media (max-width: 768px)` block (`style.css:767-794`) to `@media (max-width: 700px)` so `.nav-links` hides at exactly the width `#bottomNav` appears — closes the 701-768px gap and the ≤700px double-nav overlap in one change. Drop the now-dead `.hamburger-btn { display: flex; }` line from inside it.
- Incidental one-line cleanup while in this block: remove the dead `#fsbTab { display: none; }` rule (`style.css:284-285`) — leftover from the friends-sidebar widget deleted earlier this session; the selector no longer matches anything.

### 3. Sticky action bar, actually fixed this time
- Move `.sticky-bar`'s rule out of `bracket.html`'s and `teams-bracket.html`'s inline `<style>` blocks into `web/css/style.css` as the single canonical definition (same desktop appearance, no visual change above 700px).
- Add a `@media (max-width: 700px)` override: `position: fixed; left: 0; right: 0; bottom: calc(60px + env(safe-area-inset-bottom, 0px));` (clearing `#bottomNav`, which is `z-index: 600`) with a z-index just above it, full-width background/shadow.
- Add bottom padding to the scrolling content on pages using `.sticky-bar`, sized to clear both the fixed bar and the bottom nav — exact value tuned empirically against a real 390px viewport rather than guessed.
- Wrap `web/duel.html`'s "Start Series" button (`duel.html:229`) in the same `.sticky-bar` markup, matching the pattern already used on the other two pages.

### 4. Character/Global tables → mobile cards
- For both `#charTable` and `#globalTable`, add a sibling `#charCardList`/`#globalCardList` div (mirroring `#avgCardList`'s placement as a sibling of its `*TableWrap`), reuse the exact `.avg-card`/`.avg-card-header`/`.avg-card-detail` CSS classes already in `style.css` (generalizing their names slightly if needed, or reusing as-is — they're not `avg`-specific in what they style) rather than inventing new ones.
- `renderCharTable()` gains a card-rendering counterpart consuming the same `page` array (rank, avatar, username, character, elo, kills/deaths/kd, wins/losses, win_pct) — expandable card, tap-to-open detail like the avg cards, preserving the existing sort/filter/pagination state (cards render whatever `page` currently holds; sort/filter controls stay visible above the card list on mobile since headers disappear but the filter inputs and pager don't).
- `loadGlobal()` gains a card-rendering counterpart for `#globalCardList` (rank, avatar, username, elo, wins/losses, win_pct, kills, badge pill) — no sort control needed since this table has none today either.
- Same `@media (max-width: 700px)` swap pattern as `#avgTableWrap`/`#avgCardList`.

## Verification

1. Serve `web/` locally (same disposable-static-server approach used throughout this session) against the local backend.
2. Load the manifest URL directly and confirm valid JSON; confirm the meta tags render in a page's source.
3. Drive the app with Playwright at a 390×844 (iPhone-sized) viewport:
   - Confirm exactly one nav is visible at any width across 650px, 700px, 720px, 768px, 900px — no gap, no double-nav.
   - Confirm no console errors after deleting `nav.js`'s include.
   - On `bracket.html`/`teams-bracket.html`/`duel.html`, confirm the primary button is visible without scrolling to the true bottom, and stays fixed while scrolling the form above it.
   - On `leaderboard.html`, confirm `#charTable`/`#globalTable` are replaced by cards at 390px and the existing sort/filter/pagination controls still work against the card view; confirm nothing is clipped or overflows horizontally.
4. Spot-check at a tablet-ish width (e.g. 730px) to confirm the sidebar (not bottom nav, not hamburger) is what shows.
