// AppShell — React port of web/public/js/nav-inject.js's top bar + mobile
// bottom nav, plus the per-page "load /users/me, fill in navAvatar/
// navUsername" snippet that's currently duplicated across every legacy page
// (see e.g. favorites.html's init()). Same 8 bottom-nav links, same
// active-page highlighting, same dicebear avatar fallback -- ported logic,
// not a redesign. usePathname() replaces window.location.pathname.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiGet } from '../lib/api';

const MENU_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ width: '1em', height: '1em', verticalAlign: '-0.15em' }}>
    <line x1="4" x2="20" y1="12" y2="12" />
    <line x1="4" x2="20" y1="6" y2="6" />
    <line x1="4" x2="20" y1="18" y2="18" />
  </svg>
);

const BOTTOM_NAV_ITEMS = [
  { href: '/index.html', icon: '🏠', label: 'Home', matches: ['/index.html', '/'] },
  { href: '/play.html', icon: '⚔️', label: 'Play', matches: ['/play.html', '/duel.html', '/tournament.html'] },
  { href: '/leaderboard.html', icon: '📈', label: 'Rankings', matches: ['/leaderboard.html'] },
  { href: '/stats.html', icon: '📊', label: 'Stats', matches: ['/stats.html'] },
  { href: '/mastery.html', icon: '🎯', label: 'Mastery', matches: ['/mastery.html'] },
  { href: '/tier-list.html', icon: '🎖️', label: 'Tiers', matches: ['/tier-list.html'] },
  { href: '/favorites.html', icon: '⭐', label: 'Favs', matches: ['/favorites.html'] },
  { href: '/profile.html', icon: '👤', label: 'Profile', matches: ['/profile.html'] },
] as const;

interface Me {
  username: string;
  avatar_url?: string | null;
}

function openGameMenu() {
  // GameMenu is the legacy vanilla overlay (web/public/js/game-menu.js), not
  // yet loaded on Next.js pages -- porting it is out of scope here (deferred
  // to index.html's own migration, the page that actually owns it). Mirrors
  // nav-inject.js's own `typeof GameMenu !== 'undefined'` guard so the
  // trigger is a harmless no-op until then instead of throwing.
  if (typeof (window as unknown as { GameMenu?: { open: () => void } }).GameMenu !== 'undefined') {
    (window as unknown as { GameMenu: { open: () => void } }).GameMenu.open();
  }
}

export default function AppShell() {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<Me>('/users/me')
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {
        // Same swallow-and-skip as the legacy per-page init() blocks.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const avatarUrl = me
    ? me.avatar_url || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(me.username)}`
    : '';

  return (
    <>
      <nav id="main-nav" className="navbar">
        <Link className="logo" href="/index.html">
          Smash<span>Bros</span>
        </Link>
        <button type="button" className="menu-trigger" onClick={openGameMenu}>
          {MENU_ICON} Menu
        </button>
        <div className="nav-right">
          <div className="nav-user">
            {avatarUrl && (
              <img
                className="nav-avatar"
                src={avatarUrl}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
            <span>{me?.username ?? ''}</span>
          </div>
        </div>
      </nav>

      <nav id="bottomNav" role="navigation" aria-label="Main navigation">
        {BOTTOM_NAV_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`bnav-item${(item.matches as readonly string[]).includes(pathname) ? ' active' : ''}`}
          >
            <span className="bnav-icon">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
