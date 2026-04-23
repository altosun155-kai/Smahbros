// nav-inject.js — single source of truth for nav HTML (left sidebar + mobile bottom nav).
// Must be included before nav.js.
(function () {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  const NAV = [
    { href: 'index.html',       label: 'Home',         icon: '🏠' },
    { section: 'Compete' },
    { href: 'bracket.html',      label: 'Bracket',      icon: '🏆' },
    { href: 'duel.html',        label: '1v1 Duel',     icon: '⚔️' },
    { href: 'roundrobin.html',  label: 'Round Robin',  icon: '🔄' },
    { href: 'my-brackets.html', label: 'My Brackets',  icon: '📁' },
    { section: 'Track' },
    { href: 'stats.html',       label: 'Stats',        icon: '📊' },
    { href: 'leaderboard.html', label: 'Leaderboard',  icon: '📈' },
    { href: 'mastery.html',     label: 'Mastery',      icon: '🎯' },
    { href: 'practice.html',    label: 'Practice',     icon: '🥊' },
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
    const playPages = ['duel.html', 'tournament.html', 'roundrobin.html'];
    bnav.innerHTML =
      `<a href="index.html" class="bnav-item${currentPage === 'index.html' ? ' active' : ''}"><span class="bnav-icon">🏠</span>Home</a>` +
      `<a href="duel.html" class="bnav-item${playPages.includes(currentPage) ? ' active' : ''}"><span class="bnav-icon">⚔️</span>Play</a>` +
      `<a href="leaderboard.html" class="bnav-item${currentPage === 'leaderboard.html' ? ' active' : ''}"><span class="bnav-icon">📈</span>Rankings</a>` +
      `<a href="stats.html" class="bnav-item${currentPage === 'stats.html' ? ' active' : ''}"><span class="bnav-icon">📊</span>Stats</a>` +
      `<a href="profile.html" class="bnav-item${currentPage === 'profile.html' ? ' active' : ''}"><span class="bnav-icon">👤</span>Profile</a>`;
    document.body.appendChild(bnav);
  }
})();
