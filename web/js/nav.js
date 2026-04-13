// Loads pending invite count and shows a badge on the Invites nav link.
// Must be included AFTER api.js so apiGet is available.
(async function () {
  const link = document.querySelector('a[href="invites.html"]');
  if (!link || typeof apiGet !== 'function') return;
  try {
    const data = await apiGet('/invites/received');
    const n = (data || []).filter(i => i.status === 'pending').length;
    if (n > 0) {
      const badge = document.createElement('span');
      badge.style.cssText =
        'display:inline-flex;align-items:center;justify-content:center;' +
        'background:#e74c3c;color:#fff;font-size:0.58rem;font-weight:800;' +
        'border-radius:50%;min-width:15px;height:15px;padding:0 3px;' +
        'margin-left:5px;vertical-align:middle;line-height:1;';
      badge.textContent = n > 9 ? '9+' : String(n);
      link.appendChild(badge);
    }
  } catch (_) {}
})();
