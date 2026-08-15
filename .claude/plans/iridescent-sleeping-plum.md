# Shared game menu — extract, add overlay mode, delete the sidebar

## Context

The cinematic home menu built earlier this session (`web/public/index.html` — champion background, 3-column menu, detail panel, poster column, all driven by one `/home/summary` call) becomes the app's *only* navigation, everywhere. `web/public/js/game-menu.js` (new) owns the markup and all behavior behind a `mode` flag: `'page'` renders it inline exactly as index.html has it today; `'overlay'` renders the identical content into a dismissible modal layer, opened from a small trigger button that replaces the sidebar on every other page. `nav-inject.js`'s left sidebar (`.nav-links`) is deleted once the overlay is proven out; the mobile bottom tab bar is untouched throughout.

**Staged exactly as specified, each stage independently working and verified before the next starts**: (1) extract the current inline index.html implementation into `game-menu.js` as `mode: 'page'`, byte-for-byte equivalent — index.html must look and behave identically after this step; (2) add `mode: 'overlay'`, the trigger button, and roll it out to every other page *alongside* the still-intact sidebar; (3) delete the sidebar as its own final, cleanly-revertible step. This mirrors the user's own sequencing note almost exactly — never without working navigation.

**Grounded in what's actually in the codebase today:**
- `.navbar`/`#main-nav` is a genuine 220px fixed-left sidebar at `≥901px` (`style.css:248-316`, confirmed by reading it), a plain 58px sticky top bar below that, collapsing to logo+avatar-only (no links) at `≤700px` where the bottom tab bar takes over. Once `nav-inject.js` stops injecting `.nav-links`, the entire 901px sidebar media-query block and `.page-container`'s `margin-left: 220px` compensation become dead and get removed too — not just the JS.
- **No `document.startViewTransition` anywhere in the codebase** (confirmed via audit) — every page's cross-document transition is purely the browser-native one driven by `<meta name="view-transition" content="same-origin">`, already on all 14 pages. "Dismiss before navigating" therefore just means synchronously removing the overlay from the DOM in the link's own click handler, before the browser's native unload/capture happens — no JS transition API to coordinate with, no `preventDefault()`/delayed-navigation dance needed.
- **Escape-guard heuristic, grounded in the actual existing modals** (confirmed via audit — `profile.html:590` badge modal, `bracket.html:1408` VS/preset modals, `duel.html`/`bracket.html` character-picker dropdowns): every one of them uses the same `.classList.contains('open')` / `.classList.add('open')` convention, and all are idempotent no-ops when already closed. The overlay's Escape handler checks `document.querySelector('.open:not(#gameMenuBackdrop):not(#gameMenuOverlay), [role="dialog"]:not(#gameMenuOverlay)')` before acting — if that finds something, this keystroke is left alone (the other modal's own already-registered Escape listener closes it independently; both are plain `document.addEventListener('keydown', ...)` bubble-phase listeners with no `stopPropagation`, so this is really "don't act if something else appears to be open," not a true event-interception queue). This is a heuristic grounded in the one real convention this codebase already has, not a universal modal-stack manager — noted as such, not oversold.
- The "Lucide menu icon" is hand-copied inline SVG, matching the codebase's existing convention — `nav-inject.js`'s own `DICES_ICON` is already a hand-copied Lucide-style SVG (24×24 viewBox, round linecaps, stroke-based), not a library import. No new dependency.
- 13 pages load `nav-inject.js` today (`bracket.html`, `duel.html`, `favorites.html`, `index.html`, `invites.html`, `leaderboard.html`, `mastery.html`, `my-brackets.html`, `play.html`, `profile.html`, `stats.html`, `tier-list.html`, `tournament.html`) — the pattern (add one `<script src="js/game-menu.js"></script>` tag, positioned *before* the existing `nav-inject.js` tag) repeats identically across all of them; described once here, not enumerated per-file in execution.

## Stage 1 — Extract into `game-menu.js`, `mode: 'page'` only

New `web/public/js/game-menu.js`. Move, verbatim, everything currently inline in `index.html`: the `.home-shell`/`.home-bg`/`.home-elo-badge`/`.home-grid`/`.home-menu`/`.home-panel`/`.home-posters` CSS block, and the JS (`timeAgoFrom`, `posterHtml`, `panelContentFor`, `setPanelContent`, `wireMenuItem`, the arrow-key handler, `loadHomeSummary`, `waitForServerThenLoadHome`, the parallax listener). Wrapped in an IIFE exposing `window.GameMenu = { init(opts) }`, matching `nav-inject.js`'s own module shape.

```js
window.GameMenu = (function () {
  let mode = null;
  let summary = null;
  let summaryPromise = null;

  function init(opts) {
    mode = opts.mode; // 'page' | 'overlay'
    if (mode === 'page') {
      renderInto(opts.container);   // index.html's #homeMenuMount
      ensureSummaryLoaded();
    }
    // 'overlay' handled in Stage 2
  }

  return { init };
})();
```

`index.html` shrinks to: the `<head>` CSS block removed (moved into `game-menu.js`'s own injected `<style>`, or a new `web/public/css/game-menu.css` — a dedicated stylesheet is cleaner than JS-injected `<style>` text given this codebase's existing convention of separate CSS files, so: **new `web/public/css/game-menu.css`**, linked from every page that needs it), a single `<div id="homeMenuMount"></div>` where `.home-shell` used to sit, and `<script src="js/game-menu.js"></script>` + one line calling `GameMenu.init({ mode: 'page', container: document.getElementById('homeMenuMount') })`. Everything else on the page (invites section, `init()`'s `/users/me` + invites fetch, `dismissInvite`) stays exactly where it is — those aren't part of the menu.

**Verification before Stage 2**: index.html visually and behaviorally identical to right now — champion background, stagger-in, hover/focus panel crossfade, keyboard nav, parallax, mobile layout, empty-state fallback. Same Playwright checks already used for the original build (desktop 1440px + mobile 390px passes).

## Stage 2 — `mode: 'overlay'` + trigger, rolled out alongside the still-live sidebar

Extend `game-menu.js`:

```js
function open() {
  if (isOpen) return;
  ensureOverlayDom();          // builds it once, reused on every subsequent open
  ensureSummaryLoaded();       // never gates opening -- see below
  lastFocused = document.activeElement;
  document.body.style.overflow = 'hidden';
  document.body.style.paddingRight = scrollbarWidth() + 'px'; // no layout jump when the scrollbar disappears
  backdropEl.style.display = 'flex';
  requestAnimationFrame(() => backdropEl.classList.add('open')); // triggers the open motion (CSS, see below)
  trapFocus();
  isOpen = true;
}

function close(opts) {
  if (!isOpen) return;
  const immediate = opts && opts.immediate; // true when a menu link is navigating away (Step 7)
  releaseFocusTrap();
  const finish = () => {
    backdropEl.style.display = 'none';
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    if (lastFocused) lastFocused.focus();
    isOpen = false;
  };
  backdropEl.classList.remove('open');
  if (immediate || reducedMotion()) finish();
  else setTimeout(finish, 200); // matches the 200ms close animation
}
```

**Data (Step 4 exactly)**: `ensureSummaryLoaded()` is the same function `mode: 'page'` already uses — `open()` calls it but never `await`s it before showing the overlay; menu items render from static config (labels/hrefs never depend on the fetch) and navigate immediately, while `home-panel-content` shows the existing `.home-panel-loading` skeleton until `summary` resolves, exactly like today's cold-start behavior. Cached at module scope (`summary`/`summaryPromise`), refetched only on `visibilitychange` → `visible` (not on every `open()`). Champion image preload: once `summary.champion.character` is known, `new Image().src = charImgUrl(...)` warms the browser cache immediately — since the overlay DOM is built once and reused (hidden via class toggle, never destroyed and rebuilt), this combined with keeping the DOM alive means no flash on any open after the first, including the very first.

**Focus trap (Step 6)**: on `open()`, query `backdropEl.querySelectorAll('a[href], button:not([disabled])')`, focus the first; a `keydown` listener on `backdropEl` (not `document`, so it doesn't fight the Escape-guard logic above) handles `Tab`/`Shift+Tab` wrapping at the first/last element. `role="dialog" aria-modal="true" aria-label="Main menu"` on the overlay's panel element. Backdrop click (not panel click — check `e.target === backdropEl`) calls `close()`.

**Navigation (Step 7)**: every `<a>` inside the overlay gets one delegated `click` listener on `backdropEl` that calls `close({ immediate: true })` synchronously before the browser's own navigation proceeds — no `preventDefault()`, no delay, just a synchronous DOM mutation ahead of the native unload (confirmed safe given no JS-driven view transition to race, per Context). No `history.pushState` anywhere — Escape and backdrop-click are the only close paths, exactly as specified.

**The trigger + `nav-inject.js`**: add a `menuTrigger` button into the existing `.nav-right`-adjacent spot in the markup `nav-inject.js` already injects into `#main-nav` (logo stays; where `.nav-links` used to render, render the trigger instead — sidebar deletion is Stage 3, so for this stage both coexist: trigger added, `.nav-links` still there too, gated by two different CSS rules so they don't visually collide — trigger is `display:none` until Stage 3's CSS lands). Inline `onclick="GameMenu.open()"` (a string, lazily resolved at click time — load order between `game-menu.js` and `nav-inject.js` doesn't matter for the button itself). At the end of `nav-inject.js`'s IIFE, add:
```js
if (typeof GameMenu !== 'undefined' && !document.getElementById('gameMenuBackdrop')) {
  GameMenu.init({ mode: 'overlay', triggerEl: document.getElementById('menuTrigger') });
}
```
This means every page needs exactly one new line — `<script src="js/game-menu.js"></script>` placed *before* its existing `<script src="js/nav-inject.js"></script>` tag — nothing else per-page. Also add `<link rel="stylesheet" href="css/game-menu.css">` alongside it (same pages, same reason).

**Open/close motion (Step 5)**: backdrop fade 150ms, menu items reuse the exact same `homeItemIn` stagger keyframes from Stage 1 (40ms increments, already built), background fades 0→full opacity behind them, ~400ms total open / 200ms close — implemented as CSS transitions/animations on the backdrop + existing stagger rules, gated by the same sitewide `prefers-reduced-motion` collapse already in `style.css` (straight fade, no stagger, per Step 5's explicit requirement — the global rule already collapses animation durations to near-zero, so this is inherited for free, not new code).

**Verification before Stage 3**: overlay opens/closes correctly on every one of the 13 pages, focus trap holds, Escape correctly yields to `profile.html`'s badge modal and `bracket.html`'s VS/preset modals when those are open (manual check against the exact 3 conventions found in the audit), cold-start skeleton behavior confirmed (throttle/delay the local backend, confirm the overlay still opens instantly), scroll-position restore confirmed (scroll a tall page down, open, close, confirm unchanged), no menu-ghosting on navigation (visually confirm a same-viewport link click doesn't show the menu in the outgoing snapshot). Sidebar still present and working throughout — this stage adds, nothing removed yet.

## Stage 3 — Delete the sidebar (own commit, last)

`nav-inject.js`: remove the `NAV` array's non-Home entries' `<li>`/section-header rendering and the `.nav-links` markup entirely — keep only logo + trigger button + `.nav-right` (avatar/signout). Remove the now-dead `display:none` gate on the trigger.

`style.css`: delete the entire `/* ── Left Sidebar Layout (desktop ≥ 901px) ─────────── */` block (`:248-316`) and the `.nav-links`/`.nav-section-header` rule bodies (kept only if the trigger button reuses none of their selectors — it won't, it's new markup). Revert `.page-container` to its pre-sidebar rule (`max-width: 1100px; margin: 0 auto;`, no left offset). `.navbar` keeps only its base (58px sticky top bar) rule — no more 901px override needed since there's no sidebar content to house.

**Verification**: `grep -rn "nav-links\|nav-section-header" web/public` returns nothing outside this diff's removal. Every page still loads with a working top bar (logo + trigger + avatar/signout), the overlay still opens/closes/navigates correctly, `.page-container` centers correctly with no left gutter, mobile bottom tab bar completely unaffected (it was never touched).

## Verification (full checklist, matches the spec's own list)

1. Overlay opens on every page, including ones with their own modals — Escape closes the innermost thing first (per the `.open`-heuristic above).
2. Focus trapped inside the overlay while open; returns to the trigger button on close.
3. Opens instantly on a simulated cold/slow backend — skeleton shows in the panel, menu items are clickable and navigate immediately.
4. `grep -rn "nav-links\|nav-section-header"` clean after Stage 3.
5. Body scroll position identical before-open vs after-close on a scrolled-down page.
6. `prefers-reduced-motion` context: straight fade, no stagger, confirmed via Playwright's `reduced_motion="reduce"` context option (same pattern used earlier this session).
7. Mobile (390px): bottom tab bar unchanged, trigger button not present/visible anywhere in the DOM's visible layout.
8. No menu-ghosting: click a same-tab link from the overlay, confirm the overlay is gone from the DOM/hidden before navigation completes.
9. Local sed-`API_BASE`-and-revert + Playwright pattern throughout, same as every prior round this session. Nothing committed or pushed.
