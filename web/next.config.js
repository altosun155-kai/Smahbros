const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
      // Proxy API calls through our own origin so they're same-origin from the
      // browser's perspective -- cross-site fetches to the Render domain get
      // silently killed by ad blockers / Brave Shields (ERR_BLOCKED_BY_CLIENT),
      // which otherwise looks exactly like a server outage. WebSocket upgrades
      // are NOT routed through this -- they keep hitting the Render origin
      // directly, since Next.js rewrites don't reliably proxy WS connections.
      { source: '/api/:path*', destination: 'https://smash-bracket-api.onrender.com/:path*' },
    ];
  },
};

module.exports = nextConfig;
