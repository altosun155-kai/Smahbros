// nav.js — mobile hamburger menu
// Must be included AFTER api.js so apiGet is available.
(async function () {
  // ── Mobile hamburger ─────────────────────────────
  const navbar = document.querySelector('.navbar');
  const navLinks = document.querySelector('.nav-links');
  if (!navbar || !navLinks) return;

  // Build dropdown from existing nav links, auto-detecting active page from URL
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const dropdown = document.createElement('div');
  dropdown.className = 'nav-dropdown';
  navLinks.querySelectorAll('a').forEach(a => {
    const link = document.createElement('a');
    link.href = a.href;
    link.textContent = a.textContent.trim();
    const linkPage = a.getAttribute('href').split('/').pop().split('?')[0];
    if (linkPage === currentPage) link.classList.add('active');
    dropdown.appendChild(link);
  });
  // Also add Sign Out at the bottom
  const signOutBtn = document.querySelector('.btn-signout');
  if (signOutBtn) {
    const signOutLink = document.createElement('a');
    signOutLink.href = '#';
    signOutLink.textContent = 'Sign Out';
    signOutLink.style.cssText = 'color:#e74c3c;border-top:1px solid var(--border);margin-top:4px;padding-top:12px;';
    signOutLink.onclick = e => { e.preventDefault(); if (typeof logout === 'function') logout(); };
    dropdown.appendChild(signOutLink);
  }
  navbar.appendChild(dropdown);

  // Hamburger button
  const btn = document.createElement('button');
  btn.className = 'hamburger-btn';
  btn.setAttribute('aria-label', 'Menu');
  btn.innerHTML = '<span></span><span></span><span></span>';
  btn.onclick = () => {
    const isOpen = dropdown.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen);
  };
  navbar.appendChild(btn);

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!navbar.contains(e.target)) dropdown.classList.remove('open');
  });
})();
