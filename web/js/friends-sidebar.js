// friends-sidebar.js — right-side collapsible panel, styled like the bracket setup sidebar
// Must be included AFTER api.js

(function () {
  if (typeof apiGet !== 'function') return;

  const SIDEBAR_WIDTH = 288;

  // ── CSS ───────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #friendsSidebar {
      position: fixed;
      top: 48px;
      right: 0;
      width: ${SIDEBAR_WIDTH}px;
      height: calc(100vh - 48px);
      background: var(--card-bg, #1a1a2e);
      border-left: 1px solid var(--border, rgba(255,255,255,0.08));
      z-index: 500;
      transform: translateX(100%);
      transition: transform 0.22s ease;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    #friendsSidebar.open {
      transform: translateX(0);
      box-shadow: -6px 0 24px rgba(0,0,0,0.4);
    }

    /* Vertical tab — always visible on the right edge */
    #fsbTab {
      position: fixed;
      top: 50%;
      right: 0;
      transform: translateY(-50%);
      z-index: 501;
      background: var(--card-bg, #1a1a2e);
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-right: none;
      border-radius: 8px 0 0 8px;
      padding: 14px 7px;
      cursor: pointer;
      color: var(--text-muted, #a0aabc);
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 1px;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      white-space: nowrap;
      transition: right 0.22s ease, color 0.15s, border-color 0.15s;
      user-select: none;
    }
    #fsbTab:hover { color: var(--text, #e8edf3); border-color: var(--accent-blue, #0077c8); }

    /* Section cards matching bracket sidebar */
    .fsb-card {
      background: var(--card-bg2, #16213e);
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: var(--radius, 10px);
      padding: 16px;
    }
    .fsb-card h2 {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted, #a0aabc);
      margin: 0 0 12px;
    }

    .fsb-add-row { display: flex; gap: 6px; }
    .fsb-add-row input {
      flex: 1;
      background: var(--card-bg, #1a1a2e);
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 6px;
      color: var(--text, #e8edf3);
      padding: 6px 10px;
      font-size: 0.83rem;
    }
    .fsb-add-row input:focus { outline: none; border-color: var(--accent-blue, #0077c8); }
    .fsb-add-row button {
      background: var(--accent-blue, #0077c8);
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 6px 13px;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
    }
    .fsb-add-row button:hover { opacity: 0.85; }
    #fsbAddMsg { font-size: 0.75rem; margin-top: 6px; min-height: 14px; }

    .fsb-friend-row {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 7px 0;
      border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
    }
    .fsb-friend-row:last-child { border-bottom: none; }
    .fsb-av {
      width: 30px; height: 30px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .fsb-info { flex: 1; min-width: 0; }
    .fsb-name {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--text, #e8edf3);
      text-decoration: none;
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    a.fsb-name:hover { color: var(--accent-blue, #0077c8); }
    .fsb-status { font-size: 0.68rem; margin-top: 1px; }
    .fsb-online  { color: #4caf50; }
    .fsb-offline { color: var(--text-muted, #a0aabc); }
    .fsb-remove {
      background: none;
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 4px;
      color: var(--text-muted, #a0aabc);
      cursor: pointer;
      font-size: 0.68rem;
      padding: 3px 6px;
      flex-shrink: 0;
    }
    .fsb-remove:hover { border-color: #e74c3c; color: #e74c3c; }

    .fsb-req-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 0;
      border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
    }
    .fsb-req-row:last-child { border-bottom: none; }
    .fsb-req-btns { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
    .fsb-accept {
      background: var(--accent-blue, #0077c8);
      color: #fff; border: none;
      border-radius: 4px;
      padding: 3px 9px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
    }
    .fsb-decline {
      background: none;
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 4px;
      color: var(--text-muted, #a0aabc);
      padding: 3px 7px;
      font-size: 0.75rem;
      cursor: pointer;
    }
    .fsb-decline:hover { border-color: #e74c3c; color: #e74c3c; }

    .fsb-empty {
      font-size: 0.8rem;
      color: var(--text-muted, #a0aabc);
    }

    /* Req badge on tab */
    .fsb-req-badge {
      display: inline-block;
      background: #e74c3c;
      color: #fff;
      border-radius: 50%;
      font-size: 0.58rem;
      font-weight: 800;
      min-width: 14px;
      height: 14px;
      line-height: 14px;
      text-align: center;
      padding: 0 2px;
      margin-left: 3px;
      writing-mode: horizontal-tb;
      vertical-align: middle;
    }

    /* Nav link — keep as normal link, just intercept click */
    nav a[href="friends.html"] { cursor: pointer; }
  `;
  document.head.appendChild(style);

  // ── Sidebar HTML ──────────────────────────────────────────────────────────
  const sidebar = document.createElement('div');
  sidebar.id = 'friendsSidebar';
  sidebar.innerHTML = `
    <div class="fsb-card">
      <h2>Add Friend</h2>
      <div class="fsb-add-row">
        <input type="text" id="fsbAddInput" placeholder="Username…" autocomplete="off" />
        <button onclick="fsbSendRequest()">Add</button>
      </div>
      <div id="fsbAddMsg"></div>
    </div>
    <div class="fsb-card" id="fsbRequestsCard">
      <h2>Requests <span id="fsbReqCount"></span></h2>
      <div id="fsbRequestsList"><div class="fsb-empty">Loading…</div></div>
    </div>
    <div class="fsb-card">
      <h2>Friends</h2>
      <div id="fsbFriendsList"><div class="fsb-empty">Loading…</div></div>
    </div>
  `;
  document.body.appendChild(sidebar);

  // ── Toggle tab ────────────────────────────────────────────────────────────
  const tab = document.createElement('button');
  tab.id = 'fsbTab';
  tab.innerHTML = '▶ Friends';
  tab.setAttribute('title', 'Toggle friends panel');
  tab.onclick = () => toggleFriendsSidebar();
  document.body.appendChild(tab);

  // ── Wire up the nav Friends link ──────────────────────────────────────────
  // Wait for nav to be injected, then intercept the link
  function wireNavLink() {
    const link = document.querySelector('a[href="friends.html"]');
    if (!link) return;
    link.addEventListener('click', e => {
      e.preventDefault();
      toggleFriendsSidebar();
    });
  }
  // Try immediately, then after a tick (nav-inject may run after this script)
  wireNavLink();
  setTimeout(wireNavLink, 0);

  // ── Toggle ────────────────────────────────────────────────────────────────
  window.toggleFriendsSidebar = function (forceOpen) {
    const isOpen = sidebar.classList.contains('open');
    const open = forceOpen !== undefined ? forceOpen : !isOpen;
    sidebar.classList.toggle('open', open);
    tab.style.right = open ? SIDEBAR_WIDTH + 'px' : '0';
    tab.innerHTML   = (open ? '▶ Friends' : '◀ Friends') + (tab.querySelector('.fsb-req-badge')?.outerHTML || '');
    if (open) fsbLoadAll();
  };

  // ── Data loaders ──────────────────────────────────────────────────────────
  async function fsbLoadAll() {
    await Promise.all([fsbLoadFriends(), fsbLoadRequests()]);
  }

  async function fsbLoadFriends() {
    const el = document.getElementById('fsbFriendsList');
    try {
      const friends = await apiGet('/friends');
      if (!friends.length) {
        el.innerHTML = '<div class="fsb-empty">No friends yet.</div>';
        return;
      }
      el.innerHTML = friends.map(f => {
        const av   = f.avatar_url || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(f.username)}`;
        const name = escHtml(f.username);
        const url  = `profile.html?user=${encodeURIComponent(f.username)}`;
        return `<div class="fsb-friend-row">
          <img class="fsb-av" src="${av}" alt="${name}" onerror="this.src='https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(f.username)}'" />
          <div class="fsb-info">
            <a href="${url}" class="fsb-name">${name}</a>
            <div class="fsb-status ${f.active ? 'fsb-online' : 'fsb-offline'}">${f.active ? '● Online' : '○ Offline'}</div>
          </div>
          <button class="fsb-remove" onclick="fsbRemove(${f.id})">✕</button>
        </div>`;
      }).join('');
    } catch (_) {
      el.innerHTML = '<div class="fsb-empty">Could not load.</div>';
    }
  }

  async function fsbLoadRequests() {
    const el      = document.getElementById('fsbRequestsList');
    const countEl = document.getElementById('fsbReqCount');
    try {
      const reqs = await apiGet('/friends/requests');
      const n = reqs.length;
      countEl.textContent = n ? `(${n})` : '';

      // Update badge on tab
      const existing = tab.querySelector('.fsb-req-badge');
      if (existing) existing.remove();
      if (n > 0) {
        const badge = document.createElement('span');
        badge.className = 'fsb-req-badge';
        badge.textContent = n > 9 ? '9+' : n;
        tab.appendChild(badge);
      }

      if (!n) {
        el.innerHTML = '<div class="fsb-empty">No pending requests.</div>';
        return;
      }
      el.innerHTML = reqs.map(r => {
        const av   = r.avatar_url || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(r.username)}`;
        const name = escHtml(r.username);
        return `<div class="fsb-req-row">
          <img class="fsb-av" src="${av}" alt="${name}" onerror="this.src='https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(r.username)}'" />
          <span class="fsb-name" style="pointer-events:none">${name}</span>
          <div class="fsb-req-btns">
            <button class="fsb-accept" onclick="fsbAccept(${r.id})">✓</button>
            <button class="fsb-decline" onclick="fsbDecline(${r.id})">✕</button>
          </div>
        </div>`;
      }).join('');
    } catch (_) {
      el.innerHTML = '<div class="fsb-empty">Could not load.</div>';
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  window.fsbSendRequest = async function () {
    const input    = document.getElementById('fsbAddInput');
    const msg      = document.getElementById('fsbAddMsg');
    const username = input.value.trim();
    if (!username) return;
    msg.style.color = 'var(--text-muted)';
    msg.textContent = 'Sending…';
    try {
      await apiPost('/friends/request', { username });
      msg.style.color = '#4caf50';
      msg.textContent = `Request sent to ${username}!`;
      input.value = '';
    } catch (err) {
      msg.style.color = '#e74c3c';
      msg.textContent = err.message || 'Could not send request.';
    }
  };

  window.fsbAccept = async function (id) {
    try { await apiPost(`/friends/accept/${id}`); await fsbLoadAll(); } catch (_) {}
  };

  window.fsbDecline = async function (id) {
    try { await apiDelete(`/friends/request/${id}`); await fsbLoadAll(); } catch (_) {}
  };

  window.fsbRemove = async function (id) {
    if (!confirm('Remove this friend?')) return;
    try { await apiDelete(`/friends/${id}`); await fsbLoadFriends(); } catch (_) {}
  };

  document.getElementById('fsbAddInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') window.fsbSendRequest();
  });

  // Load badge count on page load without opening the sidebar
  try { fsbLoadRequests(); } catch (_) {}
})();
