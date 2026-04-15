// friends-sidebar.js — collapsible friends panel, works on every page
// Must be included AFTER api.js

(function () {
  if (typeof apiGet !== 'function') return;

  // ── Inject CSS ────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #friendsSidebar {
      position: fixed;
      top: 0; right: 0;
      width: 300px;
      max-width: 92vw;
      height: 100vh;
      background: var(--navbar-bg, #0a0a14);
      border-left: 1px solid var(--border, rgba(255,255,255,0.08));
      z-index: 800;
      transform: translateX(100%);
      transition: transform 0.25s ease;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    #friendsSidebar.open { transform: translateX(0); box-shadow: -8px 0 32px rgba(0,0,0,0.5); }

    #friendsSidebarOverlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 799;
      background: rgba(0,0,0,0.45);
    }
    #friendsSidebarOverlay.open { display: block; }

    .fsb-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
      flex-shrink: 0;
    }
    .fsb-header h2 { font-size: 0.95rem; font-weight: 700; color: var(--text, #e8edf3); margin: 0; }
    .fsb-close {
      background: none; border: none; color: var(--text-muted, #8892a4);
      font-size: 1.2rem; cursor: pointer; padding: 2px 6px; border-radius: 4px;
    }
    .fsb-close:hover { background: rgba(255,255,255,0.08); color: var(--text, #e8edf3); }

    .fsb-body { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 20px; }

    .fsb-section-label {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.8px; color: var(--text-muted, #8892a4); margin-bottom: 8px;
    }

    .fsb-add-row { display: flex; gap: 8px; }
    .fsb-add-row input {
      flex: 1; background: var(--card-bg2, #16213e);
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 7px; color: var(--text, #e8edf3);
      padding: 7px 10px; font-size: 0.85rem;
    }
    .fsb-add-row input:focus { outline: none; border-color: var(--accent-blue, #0077c8); }
    .fsb-add-row button {
      background: var(--accent-blue, #0077c8); color: #fff; border: none;
      border-radius: 7px; padding: 7px 14px; font-size: 0.82rem;
      font-weight: 700; cursor: pointer; white-space: nowrap;
    }
    .fsb-add-row button:hover { opacity: 0.85; }
    #fsbAddMsg { font-size: 0.78rem; margin-top: 5px; min-height: 16px; }

    .fsb-friend-row {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 0; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
    }
    .fsb-friend-row:last-child { border-bottom: none; }
    .fsb-av { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
    .fsb-name { font-size: 0.88rem; font-weight: 600; color: var(--text, #e8edf3); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fsb-status { font-size: 0.72rem; }
    .fsb-online  { color: #4caf50; }
    .fsb-offline { color: var(--text-muted, #8892a4); }
    .fsb-remove {
      background: none; border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 5px; color: var(--text-muted, #8892a4); cursor: pointer;
      font-size: 0.7rem; padding: 3px 7px;
    }
    .fsb-remove:hover { border-color: #e74c3c; color: #e74c3c; }

    .fsb-req-row {
      display: flex; align-items: center; gap: 8px;
      padding: 7px 0; border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
    }
    .fsb-req-row:last-child { border-bottom: none; }
    .fsb-req-btns { display: flex; gap: 5px; margin-left: auto; flex-shrink: 0; }
    .fsb-accept {
      background: var(--accent-blue, #0077c8); color: #fff; border: none;
      border-radius: 5px; padding: 3px 10px; font-size: 0.78rem; font-weight: 600; cursor: pointer;
    }
    .fsb-decline {
      background: none; border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 5px; color: var(--text-muted, #8892a4); padding: 3px 8px; font-size: 0.78rem; cursor: pointer;
    }
    .fsb-decline:hover { border-color: #e74c3c; color: #e74c3c; }

    .fsb-empty { font-size: 0.82rem; color: var(--text-muted, #8892a4); }

    /* Toggle button in navbar */
    .fsb-toggle-btn {
      background: none;
      border: 1px solid var(--border, rgba(255,255,255,0.08));
      border-radius: 6px;
      color: var(--text-muted, #8892a4);
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 700;
      padding: 4px 10px;
      display: flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
    }
    .fsb-toggle-btn:hover { border-color: var(--accent-blue, #0077c8); color: var(--accent-blue, #0077c8); }
    .fsb-req-badge {
      background: #e74c3c; color: #fff; border-radius: 50%;
      font-size: 0.6rem; font-weight: 800; min-width: 15px; height: 15px;
      display: inline-flex; align-items: center; justify-content: center; padding: 0 3px;
    }
  `;
  document.head.appendChild(style);

  // ── Inject sidebar HTML ───────────────────────────
  const sidebar = document.createElement('div');
  sidebar.id = 'friendsSidebar';
  sidebar.innerHTML = `
    <div class="fsb-header">
      <h2>👥 Friends</h2>
      <button class="fsb-close" onclick="toggleFriendsSidebar()">✕</button>
    </div>
    <div class="fsb-body">
      <div>
        <div class="fsb-section-label">Add Friend</div>
        <div class="fsb-add-row">
          <input type="text" id="fsbAddInput" placeholder="Username…" autocomplete="off" />
          <button onclick="fsbSendRequest()">Add</button>
        </div>
        <div id="fsbAddMsg"></div>
      </div>
      <div id="fsbRequestsSection">
        <div class="fsb-section-label">Requests <span id="fsbReqCount"></span></div>
        <div id="fsbRequestsList"><div class="fsb-empty">Loading…</div></div>
      </div>
      <div>
        <div class="fsb-section-label">Friends</div>
        <div id="fsbFriendsList"><div class="fsb-empty">Loading…</div></div>
      </div>
    </div>
  `;
  document.body.appendChild(sidebar);

  const overlay = document.createElement('div');
  overlay.id = 'friendsSidebarOverlay';
  overlay.onclick = () => toggleFriendsSidebar(false);
  document.body.appendChild(overlay);

  // ── Replace Friends nav link with toggle button ───
  const friendsLink = document.querySelector('a[href="friends.html"]');
  if (friendsLink) {
    const btn = document.createElement('button');
    btn.className = 'fsb-toggle-btn';
    btn.id = 'fsbNavBtn';
    btn.innerHTML = '👥 Friends';
    btn.onclick = () => toggleFriendsSidebar();
    friendsLink.parentElement
      ? friendsLink.parentElement.replaceWith((() => { const li = document.createElement('li'); li.appendChild(btn); return li; })())
      : friendsLink.replaceWith(btn);
  }

  // ── Toggle ────────────────────────────────────────
  window.toggleFriendsSidebar = function (forceOpen) {
    const isOpen = sidebar.classList.contains('open');
    const open = forceOpen !== undefined ? forceOpen : !isOpen;
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('open', open);
    if (open) fsbLoadAll();
  };

  // ── Data loaders ──────────────────────────────────
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
        const av = f.avatar_url || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(f.username)}`;
        return `<div class="fsb-friend-row">
          <img class="fsb-av" src="${av}" alt="${f.username}" onerror="this.src='https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(f.username)}'" />
          <div style="flex:1;min-width:0;">
            <div class="fsb-name">${f.username}</div>
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
    const el = document.getElementById('fsbRequestsList');
    const countEl = document.getElementById('fsbReqCount');
    try {
      const reqs = await apiGet('/friends/requests');
      countEl.textContent = reqs.length ? `(${reqs.length})` : '';
      // update nav button badge
      const navBtn = document.getElementById('fsbNavBtn');
      if (navBtn) {
        const existing = navBtn.querySelector('.fsb-req-badge');
        if (existing) existing.remove();
        if (reqs.length > 0) {
          const badge = document.createElement('span');
          badge.className = 'fsb-req-badge';
          badge.textContent = reqs.length > 9 ? '9+' : reqs.length;
          navBtn.appendChild(badge);
        }
      }
      if (!reqs.length) {
        el.innerHTML = '<div class="fsb-empty">No pending requests.</div>';
        return;
      }
      el.innerHTML = reqs.map(r => {
        const av = r.avatar_url || `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(r.username)}`;
        return `<div class="fsb-req-row">
          <img class="fsb-av" src="${av}" alt="${r.username}" onerror="this.src='https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(r.username)}'" />
          <span class="fsb-name">${r.username}</span>
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

  // ── Actions ───────────────────────────────────────
  window.fsbSendRequest = async function () {
    const input = document.getElementById('fsbAddInput');
    const msg   = document.getElementById('fsbAddMsg');
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
    try { await apiPost(`/friends/accept/${id}`); await fsbLoadAll(); }
    catch (_) {}
  };

  window.fsbDecline = async function (id) {
    try { await apiDelete(`/friends/request/${id}`); await fsbLoadAll(); }
    catch (_) {}
  };

  window.fsbRemove = async function (id) {
    if (!confirm('Remove this friend?')) return;
    try { await apiDelete(`/friends/${id}`); await fsbLoadFriends(); }
    catch (_) {}
  };

  // Enter key on add input
  document.getElementById('fsbAddInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') window.fsbSendRequest();
  });

  // Load request badge on page load (background, don't open sidebar)
  try { fsbLoadRequests(); } catch (_) {}
})();
