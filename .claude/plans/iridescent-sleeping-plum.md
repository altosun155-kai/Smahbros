# Visual/Animation Overhaul — "Both platforms" scope

## Context

The site currently has a flat, functional dark theme (flat `--card-bg` cards, Inter everywhere, zero animation library, no glass/gradient/noise treatment) built up over many feature-focused rounds. The user handed over a large, precisely-specified design wishlist (fonts, glassmorphism, ambient motion, GSAP-driven "moments," richer data visualization) split into three groups: **Both platforms**, **Laptop only**, **Mobile only**. Given the size (~25 items touching nearly every page), the user chose to scope this round to exactly the **Both platforms** group (Visual system + Moments + Data made visual, 15 items) and defer the laptop-only and mobile-only groups to a later round.

Two follow-up decisions were confirmed directly with the user:
- Gold shimmer stays scoped to the one-time championship banner moment, not the persistent badge chip (avoids visual noise on lists).
- Win-streak flames stay on the leaderboard only, not also the profile page (keeps the backend change to one function).

All other implementation-detail decisions below (glass card curation, view-transition portrait pairs, font-mono rollout scope, mastery refetch trigger, teams-bracket portrait substitute, bracket.html champion banner) use the recommended approach identified during research — these are additive, low-risk, reversible calls, not user-facing feature-scope choices.

No backend DB schema change is needed anywhere in this plan. The one backend change (win streak) is a query-only addition to the existing `/leaderboard` endpoint — `_run_migrations()` in `api.py` is untouched.

## Key existing code to build on (not rebuild)

- `index.html:19-30` already has a static two-gradient ambient background and a `.glass` class (`rgba(255,255,255,0.035)` + `blur(14px)`) — this is the exact recipe to promote into shared `:root` tokens, animate, and then delete the local copy from `index.html`.
- `web/profile.html:757-855` `drawEloSvg()` already has gradient area fill, grid, dashed baseline, dot, and a working tooltip — the glow effect is one new SVG `<filter>` added to the existing `<defs>`, not a rebuild.
- `web/leaderboard.html` win% is already a bar (`.winpct-bar`/`.winpct-fill`, CSS at `:92`), just using a 3-bucket color step (`:450-454` and 5 more call sites) — item 13 is a find-and-replace onto one shared interpolation helper, not new markup.
- `web/profile.html:70-73, 596-659` H2H rivalry is already functionally complete (`.h2h-bar` split bar + per-character/per-matchup fill bars) — item 14 is a styling/animation upgrade only.
- `web/bracket.html` and `web/teams-bracket.html` render brackets as pure flex `.round-col`/`.match-entry` divs with **zero connector lines today** — item 7 is genuinely new (an absolutely-positioned SVG overlay computed from `getBoundingClientRect()`).
- `routers/users.py:208-218, 708-717` already has a streak-counting loop, but it computes historical-max streak for badges, not current trailing streak — item 11 reuses the same walk pattern with different aggregation logic, added to `routers/leaderboard.py`'s `leaderboard()` function.

## Phase 0 — Shared visual foundation (`web/css/style.css`)

- Add tokens to the existing `:root` block (`:6-23`): `--font-display`, `--font-mono`, `--glass-bg`, `--glass-bg-strong`, `--glass-border`, `--glass-blur`, `--blob-a`, `--blob-b` (blob colors lifted from `index.html`'s existing gradient for visual continuity).
- Add a second `@import` for Space Grotesk + a mono family (e.g. JetBrains Mono) alongside the existing Inter import (`:3`).
- Apply `--font-display` to headers via a targeted selector list (page titles, section titles, nav logo) — not a blanket `h1,h2,h3` rule, since some headers are emoji-heavy banner text.
- Add an animated ambient background (`body::before`, two radial-gradient blobs, `@keyframes ambientDrift 40s ease-in-out infinite alternate`) generalizing `index.html:19-24`; delete that page's now-redundant local rule once the shared version lands.
- Add a noise overlay (`body::after`, inline SVG `feTurbulence` data-URI background, `opacity: 0.03`) — no new binary asset, keeps the no-build-step constraint intact.
- Update `.card` (`:322-328`) to the glass recipe (`background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); -webkit-backdrop-filter: ...;`) and add a `.glass` utility class for pages using bespoke card class names. Pair every `backdrop-filter` with `-webkit-backdrop-filter`, matching the existing convention (`style.css:258-259`).
- Add `<meta name="view-transition" content="same-origin">` to every page's `<head>` (repeated one-line addition across ~14 files) to activate cross-document view transitions site-wide.
- Add the GSAP CDN `<script>` tag — **only** to `web/bracket.html`, `web/teams-bracket.html`, `web/duel.html` (the three pages with GSAP-driven Moments); not site-wide.

## Phase 1 — Roll the foundation out per page

- **Glass cards**: apply the updated recipe to `.prof-section`/`.profile-card` (profile), `.player-showcase-card` (mastery), `.sidebar-card`/`.qs-card` (bracket/teams-bracket), `.duel-card` (duel), `.hero-card`/`.invite-card`/`.primary-card`/`.secondary-card` (index — repoint to shared tokens, delete local `.glass` def). Explicitly excluded: `.bounty-poster`/`.tombstone-poster` (themed flat-illustration aesthetic), bracket `.match-box`/`.round-col` (need crisp edges for the new connector-line overlay), `.tier-row`, and modal surfaces (`#vsModal`, `.badge-modal-box`, `#scoreModal`).
- **Scroll entrance animations**: add a `.enter-view` utility (`animation-timeline: view(); animation-range: entry 0% cover 30%;` + a fade/slide keyframe) as pure progressive enhancement (no JS/IntersectionObserver fallback — silently inert on unsupported browsers). Apply to leaderboard rows, profile activity-feed items, mastery tiles, bracket match-entries.
- **Mono font rollout**: targeted sweep, not blanket — Elo/K/D/W-L/score numbers on leaderboard, profile, duel, bracket.
- **View Transitions portrait pair**: give `index.html`'s hero character art (`:421`) and `profile.html`'s top-character thumbnail (`:689`) matching `view-transition-name: char-portrait-<slug>` (set via a small JS helper since the name is dynamic per user) — the one concrete, already-linked pair in the site today (bottom-nav Profile link connects them).

## Phase 2 — Data made visual (refinements)

- **Item 12 (Elo glow)**: add one `<filter>` (`feGaussianBlur` + `feMerge`) to `drawEloSvg()`'s existing `<defs>` in `web/profile.html`, applied only to the line `<path>`.
- **Item 13 (win% interpolation)**: new shared `web/js/color-utils.js` exposing `winPctColor(pct)` (continuous red→yellow→green), loaded on every page with a win% display, replacing the 3-bucket ternaries at all verified call sites in `web/leaderboard.html`, `web/duel.html:642`, `web/stats.html:307`, and unifying `web/profile.html:605,635`'s binary ≥50 threshold onto the same scale.
- **Item 14 (rivalry tug-of-war)**: style-only upgrade to `web/profile.html`'s existing `.h2h-bar` — glass treatment, a center-line marker so it reads as a rope rather than a split bar, a bouncier width transition. No fetch/render logic changes.
- **Item 15 (mastery claim flip)**: `web/mastery.html` `buildGrid()` — track `prevMasteryMap`, add a `rotateY` `.flip-in` keyframe only on tiles that just transitioned unowned→owned. Since `buildGrid()` currently runs once per load, add a `visibilitychange`-triggered re-fetch so there's an actual transition to observe within a session.

## Phase 3 — "Moments" (GSAP, depends on Phase 0)

- **Item 7 (connector lines)**: new `<svg id="bracketConnectors">` overlay inside `.bracket-rounds` in both `bracket.html` and `teams-bracket.html`; new `drawConnectors()` computes elbow paths from `getBoundingClientRect()` after every `renderBracket()`, animates only the connector for the just-resolved match via `gsap.to(path, {strokeDashoffset: 0, ...})`, redraws instantly on `window.resize`.
- **Item 8 (Elo count-up)**: `duel.html`'s `recordGame()` (`:805-853`, already captures `elo_delta` at `:839`) and `bracket.html`'s `recordMatchResult()` (`:895-916`, currently discards the response — needs to capture it) both get a GSAP numeric tween (`snap:"v"`) on the newly-added delta element only, not on re-renders of older rows. Does not apply to `teams-bracket.html` (no Elo there).
- **Item 9 (winner scale + ring flash)**: `bracket.html`'s `pickScore()` (`:1266-1277`) and `duel.html`'s series-winner reveal both get `gsap.fromTo(img, {scale:0.4,opacity:0}, {scale:1,opacity:1,ease:"back.out(1.7)"})` plus an expanding `ringFlash` keyframe, delaying modal-advance until animation completion. `teams-bracket.html` has no character portrait in its winner flow — the effect targets the team name/color swatch in `#winnerBanner` instead.
- **Item 10 (champion shimmer)**: `@keyframes shimmerSweep` on `#winnerBanner` in `teams-bracket.html` (`:290-293`), triggered once when `.show` is added. `bracket.html` (solo mode) has no completion banner today — add a matching one (reusing `teams-bracket.html`'s markup/CSS), shown at grand-final completion, so shimmer isn't teams-only.
- **Item 11 (streak flames)**: `routers/leaderboard.py`'s `leaderboard()` gets a query-only change — build ordered per-user match history (mirroring `routers/users.py:166-180`'s pattern), compute **current trailing** win streak (distinct from the existing historical-max badge logic), add `"streak"` to each result dict. `web/leaderboard.html` renders a flame icon (pure CSS `@keyframes flameFlicker`, no GSAP) next to usernames with `streak >= 3`. Leaderboard only, per user decision.

## Verification

1. Serve `web/` locally against the local backend (same disposable-server approach used throughout this session).
2. Visual foundation: confirm fonts/glass/ambient/noise render correctly across index, profile, leaderboard, bracket, duel, mastery at desktop width; confirm no `backdrop-filter` regressions on Safari-style `-webkit-` prefix pairing.
3. Data-viz: confirm Elo chart glow doesn't obscure the tooltip hit area; confirm win% colors now interpolate smoothly instead of stepping at every page that shows it; confirm H2H bar still reflects correct data after the styling pass.
4. Moments — exercise real match-recording flows locally (curl/Playwright): confirm connector lines draw only for the just-resolved match, not replay on unrelated re-renders; confirm Elo count-up shows the correct final value and doesn't re-animate old rows; confirm winner scale/ring-flash on both `bracket.html` and `duel.html`; confirm champion shimmer fires once on tournament completion in both bracket modes; confirm streak flame appears/disappears correctly as win streaks change.
5. Regression check: confirm nothing added here breaks the mobile-only round already shipped (700px breakpoint behavior, sticky bars, card views) — this round's CSS should layer on top without touching those media queries.
