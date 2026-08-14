# Phase 6 — GSAP shatter-transition login

## Context

Last item on the user's original 6-phase roadmap. Phase 4 built the Next.js/React scaffold specifically so upcoming features could be real React instead of bolted onto vanilla pages; Phase 5 used it for the multi-device draft. Phase 6 does the same for the login page.

**The spec (from the user, correcting this plan's first draft):** on successful auth, the *current champion's character render* breaks into image tiles that fly outward and fade — not a generic chrome/card shatter. The app's front door is whoever's currently winning, and they visibly become the interface. The champion is the **#1 player on `/leaderboard`** (by win rate). The harder part of the original spec — the tiles flying into the destination page's actual card positions — is explicitly deferred; this round is the outward-scatter version with a hard navigation underneath, done well (no dead air, no flash).

**Champion image, resolved from two already-public endpoints, no new backend work:**
1. `GET /leaderboard` (already `auth=false`-callable) → `result[0].username` is the #1 player.
2. `GET /characters/stats/{username}` (already public, no `get_current_user` dependency — confirmed in `routers/characters.py:410`) → returns `{username, stats: [{character, elo, wins, losses, games, ...}]}` for that player. Pick the row with the highest `games` (most-played), tie-broken by `elo` desc — "most-played character" isn't a concept that exists elsewhere in the codebase, so this is a one-off client-side pick, not a new server heuristic to maintain.
3. `charImgUrl(character)` (`web/app/lib/chars.ts`, already used by the draft screens) resolves that character to its Supabase Storage portrait URL.

Fallback if there's no leaderboard entry yet (fresh deploy, zero recorded matches) or the top player has zero `CharacterStats` rows: skip the image-shard version and fall back to the plain chrome shards (`var(--card-bg)` + border, no image) — same shard geometry and tween, just no picture to show. This keeps the page working on day one of a fresh deployment without a special-cased empty state.

**Blast radius is small and well-contained.** Grepping the repo for `login.html` (excluding `.next/` build output) turns up exactly 4 redirect call sites across 3 files — `web/public/js/auth.js` (`requireAuth()`, `redirectIfLoggedIn()`, `logout()`), `web/public/js/api.js` (401 handler), `web/app/lib/api.ts` (401 handler). No other vanilla page links to `login.html` directly — every page reaches it exclusively through `requireAuth()`.

**Routing correction:** Next's actual order is `headers → redirects → beforeFiles rewrites → filesystem → afterFiles rewrites`. `redirects()` (unlike the `rewrites()` already used for `/` → `/index.html`) runs *before* the filesystem check, so a `redirects()` entry for `/login.html` → `/login` fires even while `web/public/login.html` still exists on disk — but the plan still deletes that file rather than leaving two logins around, and adds the `redirects()` entry so old bookmarks land on `/login` instead of a 404.

**No new runtime dependencies.** `gsap` is already in `web/package.json` (`^3.15.0`, added in Phase 5). The shatter doesn't need the `Flip` plugin Phase 5 used (that morphs one DOM state into another via shared element IDs) — it's a one-way outward scatter, so plain `gsap.to()` per shard is enough.

## 1. `/login` route (React port of `login.html`)

New `web/app/login/page.tsx` (`'use client'`) — behavioral port of `web/public/login.html`'s inline script, reusing existing `auth.css` classes (`.auth-page`, `.auth-card`, `.tile-btn`, `.new-player-form`, …) so the base look is unchanged. `css/auth.css` is only ever linked from `login.html` today (confirmed via grep) — imported directly in the new page file, same pattern already used for `reset.css`/`style.css` in `web/app/layout.tsx`.

- **On mount**: if `getToken()` is already set, redirect to `/` immediately (replaces `login.html`'s `redirectIfLoggedIn()` guard — that function is deleted along with the vanilla page, since nothing else calls it). Also on mount: fire off `import('gsap')`, the champion-image lookup (§2), and resolve the eventual destination via `safeReturnUrl()` (§ below) — all three need to be *ready before the tap*, not fetched/computed reactively at trigger time, since the sequence is tap → `/auth/enter` round-trip → shatter, and there's no reason to add a stall right at the moment that's supposed to feel instant. `loginReturnUrl` is written to `localStorage` by `requireAuth()` *before* the redirect to `/login` even happens, so it's already available at mount time — the destination doesn't need to wait for a successful login to be known.
- Server-ready gate: port `waitForServer()`'s `/health` retry loop (up to ~90s, disables submit until ready) into `useEffect`/`useState`.
- Player tiles: port `loadPlayerTiles()` (`apiGet('/auth/users', false)`), tap-to-arm/tap-again-to-confirm state (armed username + a 2.5s timeout ref), hidden-accounts reveal link.
- New-player form: controlled input + submit handler, same validation as today (non-empty, trimmed).
- **All unauthenticated calls on this page — `/auth/users`, `/leaderboard`, `/characters/stats/{username}`, `/auth/enter` — must pass `auth=false` explicitly** (`apiGet`/`apiPost`'s existing third param in `web/app/lib/api.ts`). This isn't optional cleanup: if any of these accidentally sent a stale/invalid token and got a 401 back, `api.ts`'s 401 handler redirects to `/login` — while already on `/login`, that's a self-redirect loop. Worth a one-line comment at each call site given the loop risk, not just inherited silently.
- Shared `enter(username)` handler: `apiPost('/auth/enter', { username }, false)` → on success, `setToken`/`setUsername` (new exports needed in `web/app/lib/api.ts` — today it only has `getToken`/`getUsername`/`clearToken`, mirroring `auth.js`) → trigger the shatter (§2), which navigates from its tween's `onComplete` once the destination (prefetched on mount, see §2) is reached.
- On error: same inline error-banner behavior as today, re-enables the tile/button.
- **Destination validation**: `loginReturnUrl` is read from `localStorage` and was written elsewhere in the app as a full `window.location.href` (absolute URL, includes origin). Validate it's same-origin before using it:
  ```ts
  function safeReturnUrl(raw: string | null): string | null {
    if (!raw) return null;
    try {
      const u = new URL(raw, window.location.origin);
      return u.origin === window.location.origin ? u.href : null;
    } catch {
      return null;
    }
  }
  ```
  Destination becomes `safeReturnUrl(returnUrl) || '/'`. Low risk (this is the app's own localStorage key, not user input) but one line to close off regardless.

## 2. Shatter transition — champion image, prefetched, no dead-air nav

New `web/app/login/ShatterCard.tsx`. On mount of the `/login` page, resolve the champion image (§Context) and cache the URL in state — same "ready before the tap" reasoning as the `gsap` prefetch.

- A 3×4 grid (12 shards) desktop / **2×6 at ≤700px** (this site's standard mobile breakpoint — confirmed via `web/public/css/style.css`, used repeatedly for other pages' layout switches) of absolutely-positioned `<div>`s, each sized to the *full card's bounding box* (not just its own slice) and stacked with `position: absolute; inset: 0`. The card is narrower and taller on mobile (`.auth-card` caps at `max-width: 420px` but shrinks with viewport, while height grows with tile count) — a fixed 3×4 percentage grid over that shape produces very elongated, sliver-thin cells rather than reasonable-looking shards, so the mobile variant switches to a taller/narrower 2-column arrangement instead. Both variants are still 12 shards total, same tween code, two `clip-path` polygon sets (`.shatter-shard-desktop` / `.shatter-shard-mobile`), picked at trigger time via `window.matchMedia('(max-width: 700px)').matches`. Each shard has a unique `clip-path: polygon(...)` (irregular quad, small jitter computed once per mount) so the 12 together tile the whole card with a cracked-glass seam pattern. Each shard's background is the *same* champion image at `background-size: cover` — the `clip-path` alone determines which wedge is visible, so GSAP can `rotate`/`translate`/`scale` each shard independently and the visible slice moves correctly with it (no manual `background-position` bookkeeping needed). If no champion image resolved (§Context fallback), shards use `background: var(--card-bg); border: 1px solid var(--border)` instead — same geometry, same tween, no image.
- **Trigger sequence**: real card content (tiles/form) fades out fast (~150ms) while the shard layer fades in showing the assembled champion image; then `gsap.to()` each shard to a randomized outward `x`/`y`/`rotation` + `opacity: 0` (`gsap.utils.random` per shard, short stagger `0.02–0.03`), total tween ~650ms.
- **No dead air on navigation, without making the tween's length load-speed-dependent**: rather than timing the nav off a fraction of the tween duration (fragile — a fast load truncates the shatter, a slow one still shows dead air), the destination is **prefetched on page mount**, before any tap happens: a `<link rel="prefetch" href={dest}>` injected into `document.head` via `useEffect` once `safeReturnUrl()` resolves (mount-time, per §1). By the time the shatter actually runs, the destination page is already warm in the browser's cache, so `window.location.href = dest` fired from the tween's real `onComplete` is near-instant — the tween always plays to its full, intended length, and the handoff is still tight because the nav itself costs ~nothing.
- **No background flash**: verified `web/public/css/style.css` sets `background-color: var(--bg)` on `body` (`--bg: #0f0f17`), and that stylesheet is already the *same* file loaded by both `index.html` (via `<link>`) and every Next.js route (via `web/app/layout.tsx`'s `import '../public/css/style.css'`) — so `/login` and the destination page already share an identical background with zero extra work needed here.
- `prefers-reduced-motion` guard, same convention as `web/app/draft/[roomId]/DraftReveal.tsx`: `window.matchMedia('(prefers-reduced-motion: reduce)').matches` skips the tween entirely and navigates immediately (still via `safeReturnUrl(...) || '/'`).

CSS: new shard-specific rules (`.shatter-layer`, `.shatter-shard-desktop`, `.shatter-shard-mobile`, the two sets of 12 `clip-path` polygon variants, gated behind a `@media (max-width: 700px)` block matching the rest of the site) added to `web/public/css/auth.css` — scoped to the auth page like the rest of that file, not `style.css`.

## 3. Repoint the 4 existing redirect call sites + add the bookmark redirect

- `web/public/js/auth.js`: `requireAuth()` and `logout()` → `window.location.href = '/login'` (was `'login.html'`). `redirectIfLoggedIn()` deleted (only ever called from `login.html`, which is being deleted; its job moves into the new page's mount-time check in §1).
- `web/public/js/api.js` (line 104) and `web/app/lib/api.ts` (line 108): 401 handlers → `/login` (was `login.html` / `/login.html`).
- `web/next.config.js`: add a `redirects()` export alongside the existing `rewrites()`:
  ```js
  async redirects() {
    return [
      { source: '/login.html', destination: '/login', permanent: false },
    ];
  },
  ```

## 4. Delete `web/public/login.html`

Removed outright — fully superseded by `/login`. `web/public/css/auth.css` stays (imported from the new React page instead of a `<link>`).

## Verification

1. `npm run build` in `web/` — confirms the new route compiles and `gsap` resolves.
2. Local exercise (same sed-`API_BASE`-and-revert pattern used in Phase 5 testing) via Playwright **at the default desktop viewport**: fresh visit to `/login` with no token → tiles load → tap-to-arm → tap-to-confirm → shard layer shows the current #1 leaderboard player's most-played character → shatter plays to full length → lands on `/` with a valid token in `localStorage`. Separately confirm: visiting `/login` while already holding a token redirects straight to `/`; a stale/expired token anywhere else in the app 401s through to `/login` (not the old `login.html`); none of `/login`'s own unauthenticated calls trigger a self-redirect loop; `prefers-reduced-motion` skips the tween and still completes the redirect; a fresh-deploy state with an empty `/leaderboard` falls back to the plain chrome shards without erroring; the new-player form path works end to end.
3. **Repeat the same login → shatter → landing walkthrough at a mobile viewport** (e.g. Playwright's `iPhone 13` device profile, ~390px wide) — this is the whole reason the 2×6 mobile shard layout exists in §2, so it needs its own pass rather than trusting the desktop run: confirm the 2×6 `clip-path` set is the one actually applied (not the 3×4 desktop set), and that the assembled champion image still reads correctly (no obviously-broken seams or a shard set clearly built for the wrong aspect ratio) before scattering.
4. Confirm `/login.html` redirects to `/login` (not a 404), and repeat the `grep -rln "login.html"` sweep once done to confirm no leftover references.
5. Nothing committed or pushed — stays with the user per standing convention.
