// game-menu.js — shared cinematic menu (champion background, 3-column menu,
// detail panel, poster column), one /home/summary call drives all of it.
//
// mode: 'page'    — index.html only. Renders inline into a given container,
//                    no backdrop, no dismiss, always visible.
// mode: 'overlay' — every other page. Renders into a fixed-position dialog
//                    layer with a backdrop, dismissible. (Added in a later
//                    stage of this build -- see the plan.)
//
// Same markup, same detail panel, same data in both modes.

window.GameMenu = (function () {
  let mode = null;
  let summary = null;
  let summaryPromise = null;

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function timeAgoFrom(iso) {
    if (!iso) return '';
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function posterHtml(r) {
    const wImg = typeof charImgUrl === 'function' ? charImgUrl(r.winner_char) : '';
    const lImg = typeof charImgUrl === 'function' ? charImgUrl(r.loser_char) : '';
    const ago = timeAgoFrom(r.created_at);
    return [
      `<div class="bounty-poster" style="background-image:url('${wImg}')">
        <div class="bp-top">
          <div class="bp-header">WANTED</div>
          <div class="bp-doa">☠ Dead or Alive ☠</div>
        </div>
        <div class="bp-bottom">
          <div class="bp-name">${escHtml(r.winner)}</div>
          <div class="bp-char">${escHtml(r.winner_char)}</div>
          <div class="bp-crime">3-Stocked ${escHtml(r.loser)}</div>
          <div class="bp-time">${ago}</div>
        </div>
      </div>`,
      `<div class="bounty-poster tombstone-poster" style="background-image:url('${lImg}')">
        <div class="bp-top"><div class="bp-header">R.I.P.</div></div>
        <div class="bp-bottom">
          <div class="bp-sublabel">Here lies</div>
          <div class="bp-name">${escHtml(r.loser)}</div>
          <div class="bp-char">${escHtml(r.loser_char)}</div>
          <div class="bp-crime">3-Stocked by ${escHtml(r.winner)}</div>
          <div class="bp-time">${ago}</div>
        </div>
      </div>`,
    ];
  }

  function panelContentFor(key) {
    const s = summary;
    if (!s) return '<p class="home-panel-loading">Loading…</p>';

    if (key === 'primary') {
      if (s.in_progress) {
        const ip = s.in_progress;
        const href = ip.type === 'draft' ? `/draft/${ip.id}` : `tournament.html?id=${ip.id}`;
        return `<div class="home-panel-eyebrow">In Progress</div>
          <div class="home-panel-title">${escHtml(ip.name)}</div>
          <div class="home-panel-sub">${escHtml(ip.round_or_progress || '')} · Host ${escHtml(ip.leader)}</div>
          <a href="${href}" class="btn btn-primary home-panel-cta">Continue →</a>`;
      }
      if (s.last_session) {
        const ls = s.last_session;
        return `<div class="home-panel-eyebrow">Last Session</div>
          <div class="home-panel-title">${escHtml(ls.name)}</div>
          <div class="home-panel-sub">${ls.winner ? escHtml(ls.winner) + ' won' : 'No winner recorded'} · ${timeAgoFrom(ls.ended_at)}</div>
          <a href="bracket.html" class="btn btn-primary home-panel-cta">New Tournament →</a>`;
      }
      return `<div class="home-panel-eyebrow">Get Started</div>
        <div class="home-panel-title">Start your first tournament</div>
        <div class="home-panel-sub">Single-elimination with elo rewards.</div>
        <a href="bracket.html" class="btn btn-primary home-panel-cta">New Tournament →</a>`;
    }

    if (key === 'duel') {
      if (s.last_duel) {
        const d = s.last_duel;
        return `<div class="home-panel-eyebrow">1v1 Duel</div>
          <div class="home-panel-title">${d.result === 'W' ? 'Beat' : 'Lost to'} ${escHtml(d.opponent)}</div>
          <div class="home-panel-sub">Head-to-head record ${escHtml(d.record)} · ${timeAgoFrom(d.played_at)}</div>
          <a href="duel.html" class="btn btn-primary home-panel-cta">Play a Duel →</a>`;
      }
      return `<div class="home-panel-eyebrow">1v1 Duel</div>
        <div class="home-panel-title">Head-to-head</div>
        <div class="home-panel-sub">Live elo and stock multipliers.</div>
        <a href="duel.html" class="btn btn-primary home-panel-cta">Play a Duel →</a>`;
    }

    if (key === 'leaderboard') {
      const c = s.champion;
      return `<div class="home-panel-eyebrow">Leaderboard</div>
        <div class="home-panel-title">${c ? escHtml(c.username) : 'No champion yet'}</div>
        <div class="home-panel-sub">${c ? `${c.player_elo} elo · ${escHtml(c.character || '—')}` : 'Play a match to get on the board.'}</div>
        <a href="leaderboard.html" class="btn btn-primary home-panel-cta">View Leaderboard →</a>`;
    }

    if (key === 'mastery') {
      const played = s.mastery_coverage ? s.mastery_coverage.played : 0;
      const total = (typeof SMASH_ROSTER !== 'undefined' && SMASH_ROSTER.length) || 0;
      const pct = total ? Math.round((played / total) * 100) : 0;
      return `<div class="home-panel-eyebrow">Mastery</div>
        <div class="home-panel-title">${played}${total ? `/${total}` : ''} characters played</div>
        <div class="home-panel-sub">${total ? `${pct}% roster coverage` : 'Who owns each character.'}</div>
        <a href="mastery.html" class="btn btn-primary home-panel-cta">View Mastery →</a>`;
    }

    if (key === 'tier-list') {
      return `<div class="home-panel-eyebrow">Tier List</div>
        <div class="home-panel-title">Rank the roster</div>
        <div class="home-panel-sub">Rank all fighters your way.</div>
        <a href="tier-list.html" class="btn btn-primary home-panel-cta">Open Tier List →</a>`;
    }

    if (key === 'favorites') {
      return `<div class="home-panel-eyebrow">Favorites</div>
        <div class="home-panel-title">Your top picks</div>
        <div class="home-panel-sub">Top 10 for auto-fill.</div>
        <a href="favorites.html" class="btn btn-primary home-panel-cta">Open Favorites →</a>`;
    }

    if (key === 'profile') {
      return `<div class="home-panel-eyebrow">Profile</div>
        <div class="home-panel-title">Your profile</div>
        <div class="home-panel-sub">Match history and badges.</div>
        <a href="profile.html" class="btn btn-primary home-panel-cta">Open Profile →</a>`;
    }

    if (key === 'signout') {
      return `<div class="home-panel-eyebrow">Sign Out</div>
        <div class="home-panel-title">See you next time</div>
        <div class="home-panel-sub">Sign out of this session.</div>`;
    }

    return '';
  }

  // Crossfades the panel at ~150ms -- the panel's own min-height (CSS) is
  // what actually stops it reflowing as content length changes between items.
  function setPanelContent(root, key) {
    const el = root.querySelector('#homePanelContent');
    if (!el) return;
    el.classList.add('fading');
    setTimeout(() => {
      el.innerHTML = panelContentFor(key);
      el.classList.remove('fading');
    }, 150);
  }

  function wireMenuItem(root, el, key) {
    if (!el) return;
    el.addEventListener('mouseenter', () => setPanelContent(root, key));
    el.addEventListener('focus', () => setPanelContent(root, key));
  }

  // Arrow keys move the highlight across the unified primary+secondary list;
  // Enter is native <a> behavior already, nothing extra needed for it.
  function wireArrowKeyNav(root) {
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const active = document.activeElement;
      if (!active || !active.closest || !active.closest('#homeMenu')) return;
      if (!root.contains(active)) return;
      const items = Array.from(root.querySelectorAll('#homeMenu .home-menu-item, #homeMenu .home-menu-secondary-item'));
      const idx = items.indexOf(active);
      if (idx === -1) return;
      e.preventDefault();
      const next = e.key === 'ArrowDown' ? items[idx + 1] || items[0] : items[idx - 1] || items[items.length - 1];
      next.focus();
    });
  }

  // Secondary items never depend on /home/summary -- static from the start.
  const SECONDARY = [
    { key: 'leaderboard', label: 'Leaderboard', href: 'leaderboard.html' },
    { key: 'mastery', label: 'Mastery', href: 'mastery.html' },
    { key: 'tier-list', label: 'Tier List', href: 'tier-list.html' },
    { key: 'favorites', label: 'Favorites', href: 'favorites.html' },
    { key: 'profile', label: 'Profile', href: 'profile.html' },
    { key: 'signout', label: 'Sign Out', href: '#' },
  ];

  // The default primary slot before summary data is known -- always a real,
  // clickable "New Tournament" link (never a phantom Continue with nothing to
  // continue to). renderSummary() upgrades this to Continue if in_progress
  // exists once data arrives; on a cold/slow backend this is what the user
  // sees and can act on immediately.
  const DEFAULT_PRIMARY = { label: 'New Tournament', sub: 'Single-elimination with elo rewards.', href: 'bracket.html', context: '' };

  // Renders the full menu (primary + secondary + panel skeleton) with real,
  // wired, immediately-navigable items -- menu items never wait on the
  // /home/summary fetch (only the detail panel's content and the champion
  // background do). This is what makes "opens instantly, always" true even
  // on a cold backend: there's nothing left to build once data arrives,
  // only existing elements to update (see renderSummary).
  function renderSkeleton(root) {
    root.innerHTML = `
      <div class="home-shell" id="homeShell">
        <div class="home-bg" id="homeBg"></div>
        <div class="home-elo-badge" id="homeEloBadge" style="display:none;">
          <span id="homeEloVal">—</span><span class="home-elo-label">Elo</span>
        </div>
        <div class="home-grid">
          <nav class="home-menu" id="homeMenu" aria-label="Home menu">
            <div class="home-menu-primary" id="homeMenuPrimary">
              <a href="${DEFAULT_PRIMARY.href}" class="home-menu-item highlighted" id="homeItemPrimary">${escHtml(DEFAULT_PRIMARY.label)}<span class="hmi-sub">${escHtml(DEFAULT_PRIMARY.sub)}</span></a>
              <a href="duel.html" class="home-menu-item" id="homeItemDuel">1v1 Duel<span class="hmi-sub">Head-to-head with live elo.</span></a>
            </div>
            <div class="home-menu-secondary" id="homeMenuSecondary">
              ${SECONDARY.map((item) =>
                `<a href="${item.href}" class="home-menu-secondary-item" id="homeItem_${item.key}"${item.key === 'signout' ? ' onclick="logout();return false;"' : ''}>${escHtml(item.label)}</a>`
              ).join('')}
            </div>
          </nav>
          <div class="home-panel" id="homePanel">
            <div class="home-panel-content" id="homePanelContent">
              <p class="home-panel-loading">Loading…</p>
            </div>
          </div>
          <div class="home-posters" id="homePosters"></div>
        </div>
      </div>`;

    wireMenuItem(root, root.querySelector('#homeItemPrimary'), 'primary');
    wireMenuItem(root, root.querySelector('#homeItemDuel'), 'duel');
    SECONDARY.forEach((item) => wireMenuItem(root, root.querySelector(`#homeItem_${item.key}`), item.key));
  }

  // Updates the already-rendered menu once /home/summary resolves -- never
  // creates the primary/secondary items (renderSkeleton already did), only
  // upgrades the primary slot's label/href/context and fills in the
  // background, elo badge, detail panel, and posters.
  function renderSummary(root) {
    const s = summary;
    if (!s) return;

    if (s.champion && s.champion.character && typeof charImgUrl === 'function') {
      const bg = root.querySelector('#homeBg');
      if (bg) bg.style.backgroundImage = `url('${charImgUrl(s.champion.character)}')`;
    }
    if (s.champion) {
      const val = root.querySelector('#homeEloVal');
      const badge = root.querySelector('#homeEloBadge');
      if (val) val.textContent = s.champion.player_elo;
      if (badge) badge.style.display = 'inline-flex';
    }

    const primaryTop = s.in_progress
      ? { label: 'Continue', sub: s.in_progress.name, href: s.in_progress.type === 'draft' ? `/draft/${s.in_progress.id}` : `tournament.html?id=${s.in_progress.id}`,
          context: `${s.in_progress.round_or_progress || ''} · Host ${s.in_progress.leader}` }
      : { label: 'New Tournament', sub: 'Single-elimination with elo rewards.', href: 'bracket.html',
          context: s.last_session ? `Last: ${s.last_session.name} — ${s.last_session.winner ? s.last_session.winner + ' won' : 'no winner recorded'} · ${timeAgoFrom(s.last_session.ended_at)}` : '' };

    // .hmi-context is desktop-hidden (the detail panel already shows this) and
    // mobile-visible (mobile has no hover, so context has to live in the card).
    const primaryEl = root.querySelector('#homeItemPrimary');
    if (primaryEl) {
      primaryEl.href = primaryTop.href;
      primaryEl.innerHTML = `${escHtml(primaryTop.label)}<span class="hmi-sub">${escHtml(primaryTop.sub)}</span>${primaryTop.context ? `<span class="hmi-context">${escHtml(primaryTop.context)}</span>` : ''}`;
    }

    setPanelContent(root, 'primary');

    const postersEl = root.querySelector('#homePosters');
    postersEl.innerHTML = s.posters && s.posters.length
      ? s.posters.flatMap(posterHtml).join('')
      : '<div style="font-size:0.8rem;color:var(--text-muted);">No 3-stocks yet — stay strapped.</div>';
  }

  // Same cold-start gate as login.html's waitForServer() -- /home/summary
  // shouldn't be the thing that eats a ~30s Render wake-up with no feedback.
  // Fetched at most once per session (module-scope promise) regardless of how
  // many times a page/overlay asks for it; refetched only on visibilitychange.
  function ensureSummaryLoaded(root) {
    if (!summaryPromise) {
      summaryPromise = (async () => {
        for (let i = 0; i < 10; i++) {
          try {
            const r = await fetch(API_BASE + '/health', { cache: 'no-store' });
            if (r.ok) break;
          } catch (_) {}
          if (i === 9) break;
          await new Promise((res) => setTimeout(res, i === 0 ? 2000 : 10000));
        }
        try {
          summary = await apiGet('/home/summary');
          if (summary && summary.champion && summary.champion.character && typeof charImgUrl === 'function') {
            new Image().src = charImgUrl(summary.champion.character); // warm the cache before it's ever shown
          }
        } catch (_) {
          summary = null;
        }
        return summary;
      })();
    }
    summaryPromise.then((s) => {
      if (s) renderSummary(root);
      else {
        const el = root.querySelector('#homePanelContent');
        if (el) el.innerHTML = '<p class="home-panel-loading">Could not load home data.</p>';
      }
    });
    return summaryPromise;
  }

  function refetchSummary(root) {
    summaryPromise = null;
    summary = null;
    ensureSummaryLoaded(root);
  }

  function reducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // Subtle mouse-driven parallax on the champion background -- desktop only,
  // skipped entirely under prefers-reduced-motion (a JS-driven transform isn't
  // reached by style.css's blanket animation/transition collapse, same gap
  // handled for the draft reveal's Flip tween and the login shatter earlier
  // this session).
  function wireParallax(root) {
    if (window.innerWidth <= 700 || reducedMotion()) return;
    let rafPending = false;
    document.addEventListener('mousemove', (e) => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        const bg = root.querySelector('#homeBg');
        if (!bg) return;
        const xPct = (e.clientX / window.innerWidth - 0.5) * 2;
        const yPct = (e.clientY / window.innerHeight - 0.5) * 2;
        bg.style.transform = `scale(1.06) translate(${xPct * -1.5}%, ${yPct * -1.5}%)`;
      });
    });
  }

  let pageRoot = null;

  // ── Overlay mode ──
  let backdropEl = null;
  let panelEl = null;
  let overlayRoot = null;
  let isOpen = false;
  let triggerEl = null;
  let focusTrapHandler = null;

  function scrollbarWidth() {
    return window.innerWidth - document.documentElement.clientWidth;
  }

  // Heuristic, not a universal modal-stack manager: every existing modal in
  // this codebase (profile.html's badge modal, bracket.html's VS/preset
  // modals, the duel.html/bracket.html character-picker dropdowns) uses the
  // same .classList.contains('open') convention and is an idempotent no-op
  // when already closed -- so "something else is open" is answered by
  // checking for that same convention, excluding our own overlay elements.
  function isOtherModalOpen() {
    return !!document.querySelector('.open:not(#gameMenuBackdrop):not(#gameMenuPanel), [role="dialog"]:not(#gameMenuPanel)');
  }

  function trapFocus() {
    const initialEls = panelEl.querySelectorAll('a[href], button:not([disabled])');
    if (initialEls.length) initialEls[0].focus();
    focusTrapHandler = (e) => {
      if (e.key !== 'Tab') return;
      const focusableEls = panelEl.querySelectorAll('a[href], button:not([disabled])');
      if (!focusableEls.length) return;
      const first = focusableEls[0];
      const last = focusableEls[focusableEls.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panelEl.addEventListener('keydown', focusTrapHandler);
  }

  function releaseFocusTrap() {
    if (focusTrapHandler) panelEl.removeEventListener('keydown', focusTrapHandler);
    focusTrapHandler = null;
  }

  function ensureOverlayDom() {
    if (backdropEl) return;
    backdropEl = document.createElement('div');
    backdropEl.id = 'gameMenuBackdrop';
    panelEl = document.createElement('div');
    panelEl.id = 'gameMenuPanel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-modal', 'true');
    panelEl.setAttribute('aria-label', 'Main menu');
    backdropEl.appendChild(panelEl);
    document.body.appendChild(backdropEl);
    overlayRoot = panelEl;

    renderSkeleton(overlayRoot);
    wireArrowKeyNav(overlayRoot);
    wireParallax(overlayRoot);

    // One delegated listener: backdrop click dismisses (Step 6), any link
    // click dismisses immediately then lets the native navigation proceed
    // (Step 7 -- no preventDefault, no JS view-transition API to coordinate
    // with, just a synchronous DOM mutation ahead of the browser's own unload).
    backdropEl.addEventListener('click', (e) => {
      if (e.target === backdropEl) {
        close();
        return;
      }
      if (e.target.closest('a[href]')) close({ immediate: true });
    });
  }

  function open() {
    if (isOpen) return;
    ensureOverlayDom();
    ensureSummaryLoaded(overlayRoot); // never gates opening -- panel shows its own skeleton until this resolves
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = scrollbarWidth() + 'px'; // no layout jump when the scrollbar disappears
    backdropEl.style.display = 'flex';
    requestAnimationFrame(() => backdropEl.classList.add('open'));
    trapFocus();
    isOpen = true;
  }

  function close(opts) {
    if (!isOpen) return;
    const immediate = opts && opts.immediate;
    releaseFocusTrap();
    const finish = () => {
      backdropEl.style.display = 'none';
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
      if (triggerEl) triggerEl.focus();
      isOpen = false;
    };
    backdropEl.classList.remove('open');
    if (immediate || reducedMotion()) finish();
    else setTimeout(finish, 200); // faster than the ~400ms open -- dismissal should feel immediate
  }

  function init(opts) {
    mode = opts.mode;
    if (mode === 'page') {
      pageRoot = opts.container;
      renderSkeleton(pageRoot);
      wireArrowKeyNav(pageRoot);
      wireParallax(pageRoot);
      ensureSummaryLoaded(pageRoot);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && summary) refetchSummary(pageRoot);
      });
    } else if (mode === 'overlay') {
      triggerEl = opts.triggerEl || null;
      // Escape opens AND closes (guarded: yields to any other open modal/dialog first).
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (isOtherModalOpen()) return;
        if (isOpen) close();
        else open();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && summary && overlayRoot) refetchSummary(overlayRoot);
      });
    }
  }

  return { init, open, close };
})();
