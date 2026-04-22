// loader.js — Cube Loader overlay + page transition hook
// Must be loaded in <head> so it can show before page content renders.

(function () {
  let _overlay = null;

  function _build() {
    if (_overlay) return;
    _overlay = document.createElement('div');
    _overlay.id = 'cube-loader-overlay';
    _overlay.setAttribute('role', 'status');
    _overlay.setAttribute('aria-label', 'Loading');
    _overlay.innerHTML = `
      <div style="position:relative;display:flex;align-items:center;justify-content:center;">
        <div class="cube-glow-ring"></div>
        <div class="cube-scene">
          <div class="cube">
            <div class="cube-face front"></div>
            <div class="cube-face back"></div>
            <div class="cube-face left"></div>
            <div class="cube-face right"></div>
            <div class="cube-face top"></div>
            <div class="cube-face bottom"></div>
          </div>
        </div>
      </div>
      <div class="cube-loader-label">Loading</div>
    `;
    document.body.appendChild(_overlay);
  }

  window.showLoader = function (label = 'Loading') {
    _build();
    _overlay.querySelector('.cube-loader-label').textContent = label;
    _overlay.getBoundingClientRect();
    _overlay.classList.add('visible');
  };

  window.hideLoader = function () {
    if (!_overlay) return;
    _overlay.classList.remove('visible');
  };

  // ── Auto-show on page load, hide when fully ready ──
  // Show as soon as <body> exists, hide when all resources are loaded.
  function _autoShow() {
    _build();
    _overlay.getBoundingClientRect();
    _overlay.classList.add('visible');
  }

  if (document.body) {
    _autoShow();
  } else {
    document.addEventListener('DOMContentLoaded', _autoShow);
  }

  window.addEventListener('load', function () {
    hideLoader();
  });

  // ── Page transition: show on outgoing navigation ──
  function _isSameOriginNav(a) {
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript') || href.startsWith('mailto:')) return false;
    if (a.target === '_blank' || a.download) return false;
    try {
      const url = new URL(href, window.location.href);
      return url.origin === window.location.origin;
    } catch { return false; }
  }

  document.addEventListener('click', function (e) {
    const a = e.target.closest('a[href]');
    if (a && _isSameOriginNav(a) && !e.defaultPrevented && !e.metaKey && !e.ctrlKey) {
      showLoader();
    }
  }, true);

  window.addEventListener('beforeunload', function () {
    showLoader();
  });
})();
