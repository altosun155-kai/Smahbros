// nav-inject.js — single source of truth for nav HTML (left sidebar + mobile bottom nav).
(function () {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  const DICES_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;vertical-align:-0.15em;"><rect x="2" y="10" width="12" height="12" rx="2" ry="2"></rect><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 5.08"></path><path d="M6 18h.01"></path><path d="M10 14h.01"></path><path d="M15 6h.01"></path><path d="M18 9h.01"></path></svg>';

  const NAV = [
    { href: 'index.html',       label: 'Home',         icon: '🏠' },
    { section: 'Compete' },
    { href: 'bracket.html',       label: 'Bracket',      icon: '🏆' },
    { href: 'duel.html',         label: '1v1 Duel',     icon: '⚔️' },
    { href: '/draft',           label: 'Draft',        icon: DICES_ICON },
    { href: 'my-brackets.html',  label: 'My Brackets',  icon: '📁' },
    { section: 'Track' },
    { href: 'stats.html',       label: 'Stats',        icon: '📊' },
    { href: 'leaderboard.html', label: 'Leaderboard',  icon: '📈' },
    { href: 'mastery.html',     label: 'Mastery',      icon: '🎯' },
    { section: 'My Stuff' },
    { href: 'tier-list.html',    label: 'Tier List',    icon: '🎖️' },
    { href: 'favorites.html',   label: 'Favorites',    icon: '⭐' },
    { href: 'profile.html',     label: 'Profile',      icon: '👤' },
  ];

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  const items = NAV.map(l => {
    if (l.section) return `<li class="nav-section-header">${l.section}</li>`;
    return `<li><a href="${l.href}"${currentPage === l.href ? ' class="active"' : ''}>${l.icon} ${l.label}</a></li>`;
  }).join('');

  nav.innerHTML =
    `<a class="logo" href="index.html">Smash<span>Bros</span></a>` +
    `<ul class="nav-links">${items}</ul>` +
    `<div class="nav-right">` +
      `<div class="nav-user">` +
        `<img class="nav-avatar" id="navAvatar" src="" alt="" onerror="this.style.display='none'" />` +
        `<span id="navUsername"></span>` +
      `</div>` +
      `<button class="btn-signout" onclick="logout()">Sign Out</button>` +
    `</div>`;

  // Inject mobile bottom nav into body (CSS hides it on desktop)
  if (!document.getElementById('bottomNav')) {
    const bnav = document.createElement('nav');
    bnav.id = 'bottomNav';
    bnav.setAttribute('role', 'navigation');
    bnav.setAttribute('aria-label', 'Main navigation');
    const playPages = ['play.html', 'duel.html', 'tournament.html'];
    bnav.innerHTML =
      `<a href="index.html" class="bnav-item${currentPage === 'index.html' ? ' active' : ''}"><span class="bnav-icon">🏠</span>Home</a>` +
      `<a href="play.html" class="bnav-item${playPages.includes(currentPage) ? ' active' : ''}"><span class="bnav-icon">⚔️</span>Play</a>` +
      `<a href="leaderboard.html" class="bnav-item${currentPage === 'leaderboard.html' ? ' active' : ''}"><span class="bnav-icon">📈</span>Rankings</a>` +
      `<a href="stats.html" class="bnav-item${currentPage === 'stats.html' ? ' active' : ''}"><span class="bnav-icon">📊</span>Stats</a>` +
      `<a href="mastery.html" class="bnav-item${currentPage === 'mastery.html' ? ' active' : ''}"><span class="bnav-icon">🎯</span>Mastery</a>` +
      `<a href="tier-list.html" class="bnav-item${currentPage === 'tier-list.html' ? ' active' : ''}"><span class="bnav-icon">🎖️</span>Tiers</a>` +
      `<a href="favorites.html" class="bnav-item${currentPage === 'favorites.html' ? ' active' : ''}"><span class="bnav-icon">⭐</span>Favs</a>` +
      `<a href="profile.html" class="bnav-item${currentPage === 'profile.html' ? ' active' : ''}"><span class="bnav-icon">👤</span>Profile</a>`;
    document.body.appendChild(bnav);
  }
})();
