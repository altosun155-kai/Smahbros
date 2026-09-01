const path = require('path');

// Overridable for local dev (see scripts/dev.sh, CLAUDE.md's Working
// Conventions) -- defaults to prod so an unset env var is always the safe
// choice, never an accidental local URL shipped to Vercel.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'https://smash-bracket-api.onrender.com';

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    return [
      // '/' used to rewrite to /index.html -- removed now that app/page.tsx
      // is a real Next.js route; the app router's own filesystem routing
      // takes precedence over rewrites (afterFiles phase), so this entry
      // would never fire anymore anyway. Kept out to avoid dead config.
      // Proxy API calls through our own origin so they're same-origin from the
      // browser's perspective -- cross-site fetches to the Render domain get
      // silently killed by ad blockers / Brave Shields (ERR_BLOCKED_BY_CLIENT),
      // which otherwise looks exactly like a server outage. WebSocket upgrades
      // are NOT routed through this -- they keep hitting the Render origin
      // directly, since Next.js rewrites don't reliably proxy WS connections.
      { source: '/api/:path*', destination: `${API_PROXY_TARGET}/:path*` },
    ];
  },
  // TODO(flip to permanent once confirmed): all 14 entries below are
  // permanent: false (307) deliberately, not true (308) -- a 308 is
  // aggressively browser-cached, and if any destination below turns out
  // wrong, testers keep hitting the stale redirect from cache long after
  // this file is fixed. Flip every entry to true once a real login flow and
  // a real click-through of every nav item (including on mobile) confirm all
  // 14 land correctly, then delete this comment.
  //
  // web/public/*.html stay on disk as archives -- not deleted, not moved.
  // Next checks redirects before the filesystem (including /public), so
  // these never reach the static files anymore; the files remain readable
  // in git and on disk, just not servable. Query strings (e.g.
  // ?user=name on profile.html) pass through to the destination automatically.
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
};

module.exports = nextConfig;
