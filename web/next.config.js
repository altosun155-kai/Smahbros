const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  async rewrites() {
    return [
      { source: '/', destination: '/index.html' },
    ];
  },
  async redirects() {
    return [
      { source: '/login.html', destination: '/login', permanent: false },
    ];
  },
};

module.exports = nextConfig;
