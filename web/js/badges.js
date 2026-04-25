// Shared badge utilities — include before page scripts that render usernames.
const BADGE_ICONS = {
  specialist:    '⚔️',
  allrounder:    '🌀',
  consistent:    '📈',
  champion:      '🏆',
  serial_champ:  '🥇',
  tourney_king:  '👑',
  top3:          '🌟',
  veteran:       '🎖️',
  finisher:      '⚡',
  punching_bag:  '💀',
  // Performance & Skill
  the_wall:      '🧱',
  demon_slayer:  '😈',
  clutch_factor: '🎯',
  unstoppable:   '💪',
  // Character & Loyalty
  char_legend:   '🐉',
  roster_master: '📚',
  old_reliable:  '🔁',
  jack_of_all:   '🃏',
  // Tournament
  bronze_bomber: '🥉',
  silver_lining: '🥈',
  flawless_run:  '✨',
  executioner:   '🗡️',
  // Fun
  tax_collector: '💰',
  pacifist:      '🕊️',
  sacrificer:    '🩸',
};

// Badges that only appear on the profile page, never in compact/shared contexts
const PRIVATE_BADGES = new Set(['punching_bag']);

// Per-character emojis for the char_king badge
const CHAR_EMOJIS = {
  'Mario':              '🍄',
  'Donkey Kong':        '🦍',
  'Link':               '🗡️',
  'Samus':              '🚀',
  'Dark Samus':         '☄️',
  'Yoshi':              '🦕',
  'Kirby':              '⭐',
  'Fox':                '🦊',
  'Pikachu':            '⚡',
  'Luigi':              '👻',
  'Ness':               '🎮',
  'Captain Falcon':     '🏎️',
  'Jigglypuff':         '🎵',
  'Peach':              '🍑',
  'Daisy':              '🌼',
  'Bowser':             '🐢',
  'Ice Climbers':       '❄️',
  'Sheik':              '🌙',
  'Zelda':              '🔮',
  'Dr. Mario':          '💊',
  'Pichu':              '🐭',
  'Falco':              '🦅',
  'Marth':              '🗡️',
  'Lucina':             '💙',
  'Young Link':         '🏹',
  'Ganondorf':          '👹',
  'Mewtwo':             '🔮',
  'Roy':                '🔥',
  'Chrom':              '⚔️',
  'Mr. Game & Watch':   '🕹️',
  'Meta Knight':        '🌀',
  'Pit':                '😇',
  'Dark Pit':           '😈',
  'Zero Suit Samus':    '🔫',
  'Wario':              '💰',
  'Snake':              '💣',
  'Ike':                '🔥',
  'Pokémon Trainer':    '🎒',
  'Diddy Kong':         '🍌',
  'Lucas':              '🌟',
  'Sonic':              '💨',
  'King Dedede':        '🔨',
  'Olimar':             '🌸',
  'Lucario':            '💙',
  'R.O.B.':             '🤖',
  'Toon Link':          '🌊',
  'Wolf':               '🐺',
  'Villager':           '🌳',
  'Mega Man':           '⚙️',
  'Wii Fit Trainer':    '🧘',
  'Rosalina & Luma':    '✨',
  'Little Mac':         '🥊',
  'Greninja':           '💧',
  'Mii Brawler':        '👊',
  'Mii Swordfighter':   '🗡️',
  'Mii Gunner':         '🔫',
  'Palutena':           '✨',
  'Pac-Man':            '🟡',
  'Robin':              '📖',
  'Shulk':              '🔮',
  'Bowser Jr.':         '🖌️',
  'Duck Hunt':          '🦆',
  'Ryu':                '🥋',
  'Ken':                '🥊',
  'Cloud':              '⚡',
  'Corrin':             '🐉',
  'Bayonetta':          '💜',
  'Inkling':            '🦑',
  'Ridley':             '🦎',
  'Simon':              '⛓️',
  'Richter':            '💫',
  'King K. Rool':       '🐊',
  'Isabelle':           '🎣',
  'Incineroar':         '🔥',
  'Piranha Plant':      '🌿',
  'Joker':              '🃏',
  'Hero':               '⚔️',
  'Banjo & Kazooie':    '🐦',
  'Terry':              '👊',
  'Byleth':             '🏫',
  'Min Min':            '🍜',
  'Steve':              '⛏️',
  'Sephiroth':          '🖤',
  'Pyra/Mythra':        '🔥',
  'Kazuya':             '👿',
  'Sora':               '🔑',
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

function _badgeIcon(b) {
  return BADGE_ICONS[b.id] || '🏅';
}

// Full pill: colored badge with icon + label. Use in wide layouts (leaderboard rows).
function badgePill(username) {
  const b = _allBadges[username];
  if (!b || PRIVATE_BADGES.has(b.id)) return '';
  const icon = _badgeIcon(b);
  return `<span title="${b.label}" style="display:inline-flex;align-items:center;gap:3px;background:${b.color}22;border:1px solid ${b.color}55;color:${b.color};border-radius:10px;padding:1px 7px;font-size:0.68rem;font-weight:700;vertical-align:middle;white-space:nowrap;">${icon} ${b.label}</span>`;
}

// Icon only: just the emoji. Use in compact layouts (bracket entries, nav).
function badgeIcon(username) {
  const b = _allBadges[username];
  if (!b || PRIVATE_BADGES.has(b.id)) return '';
  const icon = _badgeIcon(b);
  return `<span title="${b.label}" style="font-size:0.85rem;vertical-align:middle;">${icon}</span>`;
}

// Injects the current user's badge icon into #navUsername after badges are loaded.
function applyNavBadge(username) {
  const el = document.getElementById('navUsername');
  if (!el) return;
  const icon = badgeIcon(username);
  el.innerHTML = (typeof escHtml === 'function' ? escHtml(username) : username) + (icon ? ' ' + icon : '');
}
