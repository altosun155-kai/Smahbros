// nav-inject.js — single source of truth for the nav HTML.
// Writes the navbar into <nav class="navbar" id="main-nav"></nav>.
// Must be included before nav.js.
(function () {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  const LINKS = [
    { href: 'index.html',       label: 'Home' },
    { href: 'bracket.html',     label: 'Bracket' },
    { href: 'roundrobin.html',  label: 'Round Robin' },
    { href: 'my-brackets.html', label: 'My Brackets' },
    { href: 'tier-list.html',   label: 'Tier List' },
    { href: 'favorites.html',   label: 'Favorites' },
    { href: 'stats.html',       label: 'Stats' },
    { href: 'leaderboard.html', label: 'Leaderboard' },
    { href: 'invites.html',     label: 'Invites' },
    { href: 'friends.html',     label: 'Friends' },
    { href: 'profile.html',     label: 'Profile' },
  ];

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  const items = LINKS.map(l =>
    `<li><a href="${l.href}"${currentPage === l.href ? ' class="active"' : ''}>${l.label}</a></li>`
  ).join('');

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
})();
