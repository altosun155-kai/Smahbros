import type { Metadata, Viewport } from 'next';
import '../public/css/reset.css';
import '../public/css/style.css';
import './styles/tokens.css';
import './styles/tailwind.css';
import AuthGate from './components/AuthGate';

// Port of the PWA <head> block that's byte-identical across all 14
// web/public/*.html pages: viewport, apple-touch-icon, apple-mobile-web-app-*,
// theme-color, view-transition. `web/app/manifest.ts` (the file-convention
// route) supplies the <link rel="manifest"> tag on its own -- no `manifest`
// field needed here. themeColor/colorScheme live on `viewport`, not
// `metadata`, as of Next 14+ (the metadata.themeColor/colorScheme fields are
// deprecated). `appleWebApp` emits the modern unprefixed
// `mobile-web-app-capable` meta tag automatically; `other` adds the legacy
// `apple-mobile-web-app-capable` tag alongside it for older iOS, plus
// `view-transition`, which has no dedicated Metadata API field.
//
// `icon` is spelled out explicitly here even though `web/app/icon.png`
// (Phase 4) already exists as a file-convention icon -- confirmed live
// (Playwright DOM check, not just curl) that setting `icons.apple` alone
// suppresses Next's automatic file-convention detection for the sibling
// `icon` key, so no <link rel="icon"> was ever emitted without this.
export const metadata: Metadata = {
  title: 'Smash Bracket',
  icons: {
    icon: '/icon.png',
    apple: '/img/apple-touch-icon.png',
  },
  appleWebApp: {
    statusBarStyle: 'black-translucent',
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'view-transition': 'same-origin',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f0f17',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
