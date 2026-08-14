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
};

module.exports = nextConfig;
