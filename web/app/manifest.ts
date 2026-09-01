// manifest.ts — Next.js file-convention manifest route (auto-served at
// /manifest.webmanifest, auto-linked into every page's <head>). Port of
// web/public/manifest.json, which every legacy page links via
// <link rel="manifest" href="manifest.json">. Only real change: start_url
// is '/' instead of the legacy 'index.html' -- that path doesn't exist as a
// route here, '/' is the real Next.js home page now.
import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SmashBros',
    short_name: 'SmashBros',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f0f17',
    theme_color: '#0f0f17',
    icons: [
      { src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
