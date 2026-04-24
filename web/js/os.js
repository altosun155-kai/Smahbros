// os.js — Smahbros window manager + System Override

// ── Window Manager ────────────────────────────────────────────────────
const OS = (() => {
  let _zTop    = 10;
  let _dragging = null;

  function isMobile() { return window.innerWidth <= 768; }

  function focus(win) {
    document.querySelectorAll('.os-window').forEach(w => w.classList.remove('focused'));
    win.classList.add('focused');
    win.style.zIndex = ++_zTop;
  }

  function hide(win) {
    win.style.display = 'none';
    _syncDock();
  }

  function show(winId) {
    const win = document.getElementById(winId);
    if (!win) return;
    win.style.display = '';
    focus(win);
    _syncDock();
  }

  function scrollToPanel(winId) {
    if (!isMobile()) { show(winId); return; }
    const win = document.getElementById(winId);
    if (!win) return;
    win.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    focus(win);
    document.querySelectorAll('.dock-btn').forEach(b => b.classList.remove('dock-active'));
    const btn = document.querySelector(`.dock-btn[data-win="${winId}"]`);
    if (btn) btn.classList.add('dock-active');
  }

  function _syncDock() {
    document.querySelectorAll('.dock-btn[data-win]').forEach(btn => {
      const win = document.getElementById(btn.dataset.win);
      btn.classList.toggle('dock-active', !!win && win.style.display !== 'none');
    });
  }

  function _clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  function _applyPosition(win, x, y) {
    // Keep at least 80px of the header visible on screen
    const maxX = window.innerWidth  - 80;
    const maxY = window.innerHeight - 80;
    win.style.transform = `translate(${_clamp(x, -win.offsetWidth + 80, maxX)}px, ${_clamp(y, 0, maxY)}px)`;
  }

  function _initDrag(win) {
    const header = win.querySelector('.os-win-header');
    if (!header) return;

    let sx = 0, sy = 0, ox = 0, oy = 0;

    const startDrag = (cx, cy) => {
      if (isMobile()) return;
      sx = cx; sy = cy;
      const m = new DOMMatrix(getComputedStyle(win).transform);
      ox = m.m41; oy = m.m42;
      _dragging = win;
      focus(win);
    };

    const moveDrag = (cx, cy) => {
      if (_dragging !== win) return;
      _applyPosition(win, ox + cx - sx, oy + cy - sy);
    };

    const endDrag = () => {
      if (_dragging === win) {
        _dragging = null;
        _savePositions();
      }
    };

    // Mouse
    header.addEventListener('mousedown', e => {
      if (e.button !== 0 || isMobile()) return;
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', e => moveDrag(e.clientX, e.clientY));
    document.addEventListener('mouseup', endDrag);

    // Touch
    header.addEventListener('touchstart', e => {
      if (isMobile()) return; // carousel handles touch on mobile
      const t = e.touches[0];
      startDrag(t.clientX, t.clientY);
    }, { passive: true });

    document.addEventListener('touchmove', e => {
      if (_dragging !== win) return;
      const t = e.touches[0];
      moveDrag(t.clientX, t.clientY);
    }, { passive: false });

    document.addEventListener('touchend', endDrag, { passive: true });
  }

  function _initCloseBtn(win) {
    const dot = win.querySelector('.d-close');
    if (!dot) return;
    dot.addEventListener('click', e => {
      e.stopPropagation();
      if (!isMobile()) hide(win);
    });
  }

  function _savePositions() {
    if (isMobile()) return;
    const pos = {};
    document.querySelectorAll('.os-window').forEach(w => {
      const m = new DOMMatrix(getComputedStyle(w).transform);
      pos[w.id] = { x: m.m41, y: m.m42 };
    });
    try { localStorage.setItem('smahbros_winpos', JSON.stringify(pos)); } catch (_) {}
  }

  function _loadPositions() {
    if (isMobile()) return;
    try {
      const saved = JSON.parse(localStorage.getItem('smahbros_winpos') || '{}');
      document.querySelectorAll('.os-window').forEach(w => {
        const p = saved[w.id];
        if (p) _applyPosition(w, p.x, p.y);
      });
    } catch (_) {}
  }

  // Mobile: update dock when user swipes between cards
  function _initMobileScroll() {
    const desktop = document.getElementById('osDesktop');
    if (!desktop) return;
    let scrollTimer;
    desktop.addEventListener('scroll', () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const wins = [...desktop.querySelectorAll('.os-window')];
        if (!wins.length) return;
        // Find which window is closest to center
        const cx = desktop.scrollLeft + desktop.offsetWidth / 2;
        let best = wins[0], bestDist = Infinity;
        wins.forEach(w => {
          const wc = w.offsetLeft + w.offsetWidth / 2;
          const d = Math.abs(wc - cx);
          if (d < bestDist) { bestDist = d; best = w; }
        });
        focus(best);
        document.querySelectorAll('.dock-btn[data-win]').forEach(btn => {
          btn.classList.toggle('dock-active', btn.dataset.win === best.id);
        });
      }, 80);
    }, { passive: true });
  }

  function init() {
    document.querySelectorAll('.os-window').forEach(win => {
      // Click-to-focus
      win.addEventListener('mousedown', () => focus(win), true);
      _initDrag(win);
      _initCloseBtn(win);
    });
    _loadPositions();
    _initMobileScroll();
    // Focus the first visible window
    const first = document.querySelector('.os-window');
    if (first) focus(first);
    _syncDock();
  }

  return { init, focus, hide, show, scrollToPanel };
})();


// ── System Override ───────────────────────────────────────────────────
const Override = (() => {
  let _cpp = 2;

  function open(type, opts = {}) {
    const panel = document.getElementById('overridePanel');
    if (!panel) return;
    panel.innerHTML = _render(type, opts);
    document.getElementById('systemOverride').classList.add('active');
    // Focus first input
    setTimeout(() => { const inp = panel.querySelector('.os-input'); if (inp) inp.focus(); }, 50);
  }

  function close() {
    document.getElementById('systemOverride').classList.remove('active');
  }

  function _render(type, opts) {
    if (type === 'newTournament') return _renderNewTournament(opts);
    return '';
  }

  function _renderNewTournament({ friends = [] } = {}) {
    const n = Math.floor(Math.random() * 99) + 1;
    const playerRows = friends.map(f =>
      `<label class="player-check-row">
        <input type="checkbox" name="p" value="${_esc(f)}" checked />
        <span>${_esc(f)}</span>
      </label>`
    ).join('');

    return `
      <div class="override-header">
        <span class="override-title">⚡ New Tournament</span>
        <button class="override-abort" onclick="Override.close()">Abort</button>
      </div>
      <div class="override-body">
        <div class="os-field">
          <label class="os-label">Tournament Name</label>
          <input class="os-input" id="ov-name" placeholder="Squad Session #${n}" autocomplete="off" />
        </div>

        <div class="os-field">
          <label class="os-label">Chars per Player</label>
          <div class="cpp-row">
            ${[1,2,3,4].map(v =>
              `<button type="button" class="os-btn cpp-btn ${v === 2 ? 'os-btn-primary' : ''}"
                data-cpp="${v}" onclick="Override.setCpp(${v},this)">${v}</button>`
            ).join('')}
          </div>
        </div>

        ${friends.length ? `
        <div class="os-field">
          <label class="os-label">Bracket Style</label>
          <select class="os-input" id="ov-style" style="cursor:pointer;">
            <option value="strongVsWeak">Strong vs Weak</option>
            <option value="strongVsStrong">Strong vs Strong</option>
            <option value="random">Random</option>
          </select>
        </div>` : ''}

        <button class="os-btn os-btn-primary" style="width:100%;padding:11px;margin-top:4px;"
          onclick="Override.submitNewTournament()">
          Generate Lobby →
        </button>
        <div id="ov-err" style="color:#ff6060;font-size:0.76rem;margin-top:9px;text-align:center;min-height:1.2em;"></div>
      </div>
    `;
  }

  function setCpp(n, btn) {
    _cpp = n;
    document.querySelectorAll('[data-cpp]').forEach(b => b.classList.remove('os-btn-primary'));
    btn.classList.add('os-btn-primary');
  }

  async function submitNewTournament() {
    const nameEl = document.getElementById('ov-name');
    const name   = nameEl.value.trim() || nameEl.placeholder;
    const errEl  = document.getElementById('ov-err');
    const styleEl = document.getElementById('ov-style');
    errEl.textContent = '';

    try {
      const token = typeof getToken === 'function' ? getToken() : null;
      const base  = typeof API_BASE !== 'undefined' ? API_BASE : '';
      const res = await fetch(`${base}/brackets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name,
          chars_per_player: _cpp,
          bracket_style: styleEl ? styleEl.value : 'strongVsWeak',
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      const b = await res.json();
      close();
      window.location.href = `tournament.html?id=${b.id}`;
    } catch (e) {
      errEl.textContent = 'Error: ' + e.message;
    }
  }

  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
  });

  return { open, close, setCpp, submitNewTournament };
})();
