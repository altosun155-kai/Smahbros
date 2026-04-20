// Shared badge utilities — include before page scripts that render usernames.
const BADGE_ICONS = {
  specialist:   '⚔️',
  allrounder:   '🌀',
  consistent:   '📈',
  champion:     '🏆',
  serial_champ: '🥇',
  tourney_king: '👑',
  top3:         '🌟',
  veteran:      '🎖️',
  finisher:     '⚡',
  punching_bag: '💀',
  char_king:    '👾',
};

let _allBadges = {};     // username -> {id, label, color}
let _badgesReady = false;
let _badgesPromise = null;

function loadAllBadges() {
  if (_badgesReady) return Promise.resolve(_allBadges);
  if (_badgesPromise) return _badgesPromise;
  _badgesPromise = apiGet('/users/badges/all')
    .then(data => { _allBadges = data || {}; _badgesReady = true; return _allBadges; })
    .catch(() => { _allBadges = {}; _badgesReady = true; return _allBadges; });
  return _badgesPromise;
}

// Full pill: colored badge with icon + label. Use in wide layouts (leaderboard rows).
function badgePill(username) {
  const b = _allBadges[username];
  if (!b) return '';
  const icon = BADGE_ICONS[b.id] || '🏅';
  return `<span title="${b.label}" style="display:inline-flex;align-items:center;gap:3px;background:${b.color}22;border:1px solid ${b.color}55;color:${b.color};border-radius:10px;padding:1px 7px;font-size:0.68rem;font-weight:700;vertical-align:middle;white-space:nowrap;">${icon} ${b.label}</span>`;
}

// Icon only: just the emoji. Use in compact layouts (bracket entries, nav).
function badgeIcon(username) {
  const b = _allBadges[username];
  if (!b) return '';
  return `<span title="${b.label}" style="font-size:0.85rem;vertical-align:middle;">${BADGE_ICONS[b.id] || '🏅'}</span>`;
}

// Injects the current user's badge icon into #navUsername after badges are loaded.
function applyNavBadge(username) {
  const el = document.getElementById('navUsername');
  if (!el) return;
  const icon = badgeIcon(username);
  el.innerHTML = (typeof escHtml === 'function' ? escHtml(username) : username) + (icon ? ' ' + icon : '');
}
