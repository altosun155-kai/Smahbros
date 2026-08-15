// nav-inject.js — single source of truth for nav HTML (top bar + mobile bottom nav).
(function () {
  const nav = document.getElementById('main-nav');
  if (!nav) return;

  const MENU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:1em;height:1em;vertical-align:-0.15em;"><line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line></svg>';

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

  nav.innerHTML =
    `<a class="logo" href="index.html">Smash<span>Bros</span></a>` +
    `<button type="button" class="menu-trigger" id="menuTrigger" onclick="GameMenu.open()">${MENU_ICON} Menu</button>` +
    `<div class="nav-right">` +
      `<div class="nav-user">` +
        `<img class="nav-avatar" id="navAvatar" src="" alt="" onerror="this.style.display='none'" />` +
        `<span id="navUsername"></span>` +
      `</div>` +
      `<button class="btn-signout" onclick="logout()">Sign Out</button>` +
    `</div>`;

  if (typeof GameMenu !== 'undefined' && !document.getElementById('gameMenuBackdrop')) {
    GameMenu.init({ mode: 'overlay', triggerEl: document.getElementById('menuTrigger') });
  }

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
