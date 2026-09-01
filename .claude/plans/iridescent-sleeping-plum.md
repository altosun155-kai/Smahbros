# Retire legacy .html pages — redirect to React, archive the files

## Context

The Next.js migration (0.3 → Phase 4, tracked in this same plan file previously) is complete: all 14 `web/public/*.html` pages have real React ports under `web/app/*`, verified live. But nothing in that work actually cut over traffic — `web/public/*.html` is still fully reachable, and per this session's own investigation, **the main bottom nav bar rendered on every single React page currently links to the legacy `.html` versions**, not the React ports, for 7 of its 8 items. The user asked to redirect everything to the React pages now and keep the old HTML files as archives (not delete them).

Investigation (direct grep across `web/app`, confirmed against `next.config.js` and the Next.js redirects docs) found two distinct things to fix, not one:

1. **No redirects exist from old paths to new ones.** `next.config.js` has no `redirects()` key at all — visiting `/duel.html` today serves the static legacy file untouched, with no cutover.
2. **Several places in the *already-ported React code* still link to the legacy `.html` paths directly**, instead of the React routes that have existed since Phase 2. This is the more consequential bug — real users clicking real nav links in the new app get sent back into the old vanilla-JS pages:
   - `web/app/components/AppShell.tsx` — the shared bottom nav (rendered on every page via `AuthGate`): 7 of 8 `href`s point at `/play.html`, `/leaderboard.html`, `/stats.html`, `/mastery.html`, `/tier-list.html`, `/favorites.html`, `/profile.html`. Their `matches` arrays (used for active-tab highlighting) also reference the `.html` paths, which is harmless dead weight once fixed (`usePathname()` never reports a `.html` path for an App Router route) but worth cleaning up alongside the `href`s rather than leaving stale.
   - `web/app/play/page.tsx` — the "1v1 Duel" card links to `/duel.html` instead of `/duel`.
   - `web/app/draft/[roomId]/DraftCharacterSelect.tsx:205` — a "view tier list" link points at `/tier-list.html` instead of `/tier-list`.
   - `web/app/stats/page.tsx:392` — a player-name link builds `/profile.html?user=...`; confirmed `web/app/profile/page.tsx` already reads the same `?user=` param via `useSearchParams()`, so `/profile?user=...` is a drop-in fix.
   - `web/app/login/page.tsx:44,116` — post-login redirect uses `window.location.href = 'index.html'` (a **relative** path, no leading slash) instead of `/`. This isn't just a legacy-path issue: since it's relative, it resolves against the current URL rather than the site root, so it happens to still land on `/index.html` today only because `/login` has no trailing slash — worth fixing to `/` outright rather than relying on that coincidence.

Confirmed via the Next.js redirects doc (`node_modules/next/dist/docs/.../redirects.md`): "Redirects are checked before the filesystem which includes pages and `/public` files" — so a `redirects()` entry for `/duel.html` will intercept the request before Next ever serves the static file in `web/public/duel.html`. This means the legacy files can stay exactly where they are (true archives, unreferenced but present) with no need to move or rename them.

**Checked and cleared**: whether any *already-live* React page still executes `web/public/js/{nav-inject,game-menu,auth}.js` at runtime, which would mean those scripts' own internal `.html` links (there are many — `nav-inject.js`'s nav markup, `game-menu.js`'s panel CTAs and menu items) are live on a React page today, invisible to a `.tsx`-only grep. They are not: `app/page.tsx` only imports `game-menu.css` (styling), and reimplements every one of `game-menu.js`'s links natively in JSX already pointed at clean routes (`/duel`, `/my-brackets`, `/bracket`, etc.) — confirmed by reading its actual `<Link href>` values, not just its header comment (which references the legacy file descriptively, as a porting note, not a live dependency). Every other file matching a grep for these script names (`AppShell.tsx`, `AuthGate.tsx`, `useServerReady.ts`, `useAuthGuard.ts`, `api.ts`, `play/page.tsx`) does so only in comments describing what was ported from. No React page has a `<script src>` or dynamic-import pointing at any of the three legacy JS files.

## Changes

**1. `next.config.js`** — add a `redirects()` export alongside the existing `rewrites()`, one entry per legacy page. **`permanent: false` (307) for now, not `true`** — a 308 is aggressively browser-cached, and this cutover just turned up 5 bad internal links nobody had spotted; if any of these 14 destinations turns out wrong, a 308 means testers keep hitting the stale redirect from cache long after the config is fixed. Flip every entry to `permanent: true` once all 14 are confirmed landing correctly in real use (real login flow, real nav clicks, not just curl) — leave a `// TODO(flip to permanent once confirmed)`-style comment at the top of the block so that follow-up isn't forgotten.

```js
async redirects() {
  return [
    { source: '/index.html', destination: '/', permanent: false },
    { source: '/login.html', destination: '/login', permanent: false },
    { source: '/play.html', destination: '/play', permanent: false },
    { source: '/my-brackets.html', destination: '/my-brackets', permanent: false },
    { source: '/favorites.html', destination: '/favorites', permanent: false },
    { source: '/invites.html', destination: '/invites', permanent: false },
    { source: '/stats.html', destination: '/stats', permanent: false },
    { source: '/mastery.html', destination: '/mastery', permanent: false },
    { source: '/tier-list.html', destination: '/tier-list', permanent: false },
    { source: '/duel.html', destination: '/duel', permanent: false },
    { source: '/leaderboard.html', destination: '/leaderboard', permanent: false },
    { source: '/profile.html', destination: '/profile', permanent: false },
    { source: '/tournament.html', destination: '/tournament', permanent: false },
    { source: '/bracket.html', destination: '/bracket', permanent: false },
  ];
},
```
Query strings pass through automatically (confirmed in the docs), so `/profile.html?user=foo` → `/profile?user=foo` needs no special-casing.

**2. Fix the internal links found above** so the React app links directly to its own routes instead of bouncing through the new redirect:
- `AppShell.tsx`: rewrite all 8 `BOTTOM_NAV_ITEMS` entries to real routes (`/play`, `/leaderboard`, `/stats`, `/mastery`, `/tier-list`, `/favorites`, `/profile`) and drop the now-dead `.html` entries from each `matches` array.
- `play/page.tsx`: `/duel.html` → `/duel`.
- `draft/[roomId]/DraftCharacterSelect.tsx:205`: `/tier-list.html` → `/tier-list`.
- `stats/page.tsx:392`: `` `/profile.html?user=...` `` → `` `/profile?user=...` ``.
- `login/page.tsx:44,116`: `window.location.href = 'index.html'` → `'/'` (both occurrences; the second keeps its `returnUrl ||` fallback).

**3. Leave `web/public/*.html` untouched** — no deletion, no move. They stay as inert archives, reachable only by someone typing the exact old URL, which now 307s them straight to the React page (308 once flipped, per point 1).

**4. CLAUDE.md** — update the Architecture section's framing (the "both are currently live and both are currently deployed" line) to reflect that `web/public/*` is now redirect-only archive, not a live parallel surface. This is the only place a future session would learn that — make sure it actually lands, not just gets mentioned in this plan. Also note there: once the redirects are live, the archived pages are unreachable **by URL** (including by a developer typing `/duel.html` to compare legacy behavior against the React port side-by-side, the exact verification method used throughout this migration) — the files remain fully readable in git history and on disk, just not servable. Worth knowing before relying on live side-by-side comparison again for any future port-correctness question.

## Verification

1. `cd web && npm run build` — clean, confirm no redirect/rewrite conflicts reported.
2. Local harness: `curl -I` each of the 14 old paths (e.g. `/duel.html`) — confirm `307` (matching `permanent: false` above; re-check for `308` only after the later flip) with `Location` pointing at the correct new route, including the query-string case (`/profile.html?user=x`).
3. Playwright: load a ported page (e.g. `/stats`), click through every bottom-nav item — confirm each navigates directly to its React route with no visible redirect hop (check `location.pathname` after each, not just that it eventually lands right).
4. Confirm `/duel` from `play/page.tsx`'s card, `/tier-list` from the draft character-select link, and a real login flow's post-login landing page (`/`) all point directly at React routes now.
5. `git status --short web/public/` — empty, confirms the archived files themselves are untouched.
6. **`grep -rn "\.html" web/app/` should return nothing but comments.** This is the check that would have caught this task's own bad links before a user did — run it after all fixes land, not just against the 5 known-bad spots, so a sixth link nobody's spotted yet doesn't slip through the same way.
7. Nothing committed or pushed, per standing convention.

## Follow-up (after this lands and is confirmed live — not part of this pass)

- **Flip `permanent: false` → `true` on all 14 redirects, and delete the `TODO(flip to permanent once confirmed)` comment**, once a real login flow and a real click-through of every nav item (including on mobile) confirm all 14 destinations are correct. A `permanent: false` left indefinitely in `next.config.js` is exactly the kind of thing that quietly survives a year — don't let this be a one-time "later."
- **Re-run `grep -rn "\.html" web/app/` periodically, not just once now.** The check is only as good as the last time someone ran it, and new pages/links will keep getting added after this task is done. Worth a mental note (or an actual CI/lint step, if that's ever worth building) rather than treating this pass's clean grep as a permanent guarantee.
