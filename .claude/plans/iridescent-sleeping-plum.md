# Migration — 0.3, 0.4, 0.5, Phase 1 now; Phase 2 page-by-page after

## Context

0.1 (docs) and 0.2 (tokens/Tailwind) are done and verified. The user asked to move on from relying on the legacy HTML and "do the rest of the todos" — i.e. 0.3, 0.4, 0.5, Phase 1, Phase 2 (14 legacy pages), Phase 3 (PWA), Phase 4 (polish).

That full scope is too large to pre-plan or build in one pass responsibly — 14 legacy pages totaling ~9,100 lines, several with substantial stateful behavior (`tournament.html`'s VS-score modal, `bracket.html`'s bracket engine). Pre-planning every page's exact behavior now, before reading each page closely, would violate this repo's own norm ("precise, detailed specs are the norm here") — I'd be guessing at edge cases I haven't read yet.

So this plan covers the **foundational batch** concretely (0.3, 0.4, 0.5, Phase 1 — these don't require per-page archaeology, and everything else is blocked on them). Phase 2 is scoped as a **sequenced page-by-page loop** that starts immediately after, each page read and ported individually (no separate approval stop per page — proceeding page-by-page is itself what's being approved here), with an update after each page rather than one after all 14. Phase 3/4 are sketched at a level appropriate to plan now and will get their own concrete plan once Phase 2 is done and their actual remaining surface is known.

Existing patterns confirmed by reading the code (reuse these, don't reinvent):
- `web/app/draft/*` is the one real precedent for a migrated page: `'use client'`, `apiGet`/`apiPost` from [api.ts](web/app/lib/api.ts), legacy CSS classes (`btn btn-primary`, `card`, `page-container`) applied directly via `className` — no component library yet, that's what 0.3 builds.
- `apiFetch` in [api.ts](web/app/lib/api.ts) already 401-redirects to `/login.html` reactively — that's a *fallback*, not a guard; nothing today blocks an unauthenticated render before data loads, which is what 0.4 fixes.
- [nav-inject.js](web/public/js/nav-inject.js) is the single source of truth for the legacy nav (top bar + mobile bottom nav) — 0.4's React shell ports this exact structure/link list, not a redesign.
- [auth.js](web/public/js/auth.js) — `getToken`/`isLoggedIn`/`requireAuth`/`redirectIfLoggedIn`/`logout` — 0.4's guard is the React-idiomatic equivalent of these, reusing `getToken`/`clearToken` already in `api.ts`.
- `web/next.config.js` rewrites `/` → `/index.html` and proxies `/api/*` → Render. This stays as-is until `index.html` itself migrates (last-but-one in the Phase 2 order below, since `/` needs to flip from that rewrite to a real `app/page.tsx` in the same change).
- `GET /health` already exists (`api.py:135`) — Phase 1 is a client-side polling/UX addition only, no backend work.

## 0.3 — Component base

New `web/app/components/`: `Button`, `Card`, `Modal`, `Toast` (wraps the existing `showToast` in `api.ts` rather than replacing it), `PageContainer`. Each is a thin wrapper around the **existing** legacy CSS classes (`.btn`, `.btn-primary`, `.btn-outline`, `.card`, `.page-container`, `.glass`, modal markup patterns already in `style.css`) with typed props — not new visual design, since `tokens.css`/`style.css` already define the look. This replaces draft's current pattern of hand-typing `className="btn btn-primary"` and inline `style={{...}}` per page. Retrofit `web/app/draft/*` to use the new components in the same pass, since it's the only existing consumer and leaving it on the old pattern would mean two conventions live side by side immediately.

**Done when**: `draft/page.tsx` and `draft/[roomId]/*` use the new components with no visual change (screenshot diff before/after); `npm run build` clean.

## 0.4 — Auth guard + app shell

- `web/app/lib/useAuthGuard.ts`: client hook — on mount, if `!getToken()`, `router.replace('/login.html')` (matches `requireAuth()`'s redirect target exactly) and renders nothing until the check resolves, avoiding a flash of protected content. Store `loginReturnUrl` in `localStorage` exactly as `auth.js` does, so a login on the legacy page can hand back to a Next.js route.
- `web/app/components/AppShell.tsx`: React port of `nav-inject.js` — top bar with logo/menu-trigger/user avatar+name, mobile bottom nav with the same 8 links and the same active-page highlighting logic, ported to `usePathname()` instead of `window.location.pathname`. The existing `GameMenu` overlay (vanilla JS, used by the menu trigger) stays as-is for now — 0.4 doesn't port it, just wires the trigger to call it the same way `nav-inject.js` does, since GameMenu isn't in scope until whichever Phase-2 page actually owns it (`index.html`).
- Wire both into `layout.tsx`, replacing the current placeholder back-link.

**Done when**: an unauthenticated visit to `/draft` redirects to `/login.html` (no flash); an authenticated visit shows the ported nav with correct active-state highlighting; legacy pages are unaffected (they don't route through this layout's guard).

## 0.5 — Local-dev harness

Formalize the already-used-ad-hoc convention from CLAUDE.md's Working Conventions into an actual runnable script (`scripts/dev.sh` or `package.json` root script): scratch SQLite DB, throwaway `SECRET_KEY`, backend on 8850, frontend on 8851, temporarily-pointed `API_BASE`/`WS_ORIGIN`/`next.config.js` rewrite — as an opt-in flag/env rather than hand-editing those constants each time, so switching back to production values before wrapping a change is a diff revert, not a manual re-type. Exact mechanism (shell script vs. `.env.local` + doc) to be decided while implementing based on what's cleanest against `next.config.js`'s current hardcoded rewrite URL.

**Done when**: one command brings up backend+frontend against the scratch DB; reverting to prod config is a single `git checkout` of the touched files, not manual re-editing.

## Phase 1 — Cold-start keep-warm

Client-side only (`GET /health` already exists). Add a lightweight ping-on-load in the new `AppShell`/root layout: fire `GET /api/health` on mount; if it hasn't resolved within ~4s, show the existing "server waking up" toast pattern (reuse `showToast` from `api.ts`) instead of leaving the user staring at a blank/loading page — matching the ~4s threshold already documented in CLAUDE.md's Gotchas for the legacy lobby. No backend change.

## Phase 2 — Page-by-page migration (sequenced, no per-page approval stop)

Order, smallest/lowest-risk to largest/most stateful, with `login.html` pulled to the front since 0.4's guard needs a real login flow to redirect to and verify against:

1. `login.html` (218 lines)
2. `play.html` (107)
3. `my-brackets.html` (183)
4. `favorites.html` (228)
5. `invites.html` (304)
6. `stats.html` (389)
7. `mastery.html` (480)
8. `tier-list.html` (500)
9. `duel.html` (944)
10. `leaderboard.html` (953)
11. `profile.html` (1316)
12. `index.html` (232 lines, but ordered here because flipping `/` from `next.config.js`'s rewrite to a real `app/page.tsx` is safest once everything it links to already exists as a Next.js route)
13. `tournament.html` (1572) — per the user's own correction, this is a **port** of the existing VS-score modal (`pickTournamentScore`, stock scores, 30s undo, winner banner, `PATCH /brackets/{id}/winner`), not new design
14. `bracket.html` (1667) — last: the bracket-engine page, highest line count, most other pages link into it

For each page: read the legacy `.html` + any page-specific `.js`, port markup/behavior 1:1 into `web/app/<route>/page.tsx` using the 0.3 components + 0.4 shell/guard, verify against the running legacy page side-by-side (Playwright), then move to the next page. Report progress after each page rather than batching all 14 into one final report, so anything that looks off surfaces early.

## Phase 3 — PWA / Phase 4 — Launch polish

Not concretely planned yet — both depend on Phase 2 being complete (a PWA manifest/service worker needs final routes to exist; launch polish needs the final page set to audit). Will scope these for real once Phase 2 finishes.

## Verification (for 0.3/0.4/0.5/Phase 1, this round)

1. `cd web && npm run build` — clean.
2. Local harness (once 0.5 exists, else the existing manual scratch-DB steps): unauthenticated `/draft` → redirects to `/login.html`, no flash; authenticated → shows ported nav, correct active link.
3. Screenshot diff of `/draft` before/after 0.3's component swap — no visual change.
4. Simulate a slow/cold backend (or just observe real Render cold start) → "waking up" toast appears within ~4s.
5. Legacy pages (e.g. `index.html`) still render unaffected — nothing in this batch touches `web/public/*`.
6. Nothing committed or pushed, per standing convention.
