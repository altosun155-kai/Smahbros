// badges.ts — TS port of web/public/js/badge-data.js + badges.js. Shared by
// duel/leaderboard/profile (as those migrate) -- kept as one module like
// chars.ts/colorUtils.ts rather than re-derived per page.

export const BADGE_ICONS: Record<string, string> = {
  specialist: '⚔️',
  allrounder: '🌀',
  consistent: '📈',
  champion: '🏆',
  serial_champ: '🥇',
  tourney_king: '👑',
  top3: '🌟',
  veteran: '🎖️',
  finisher: '⚡',
  punching_bag: '💀',
  the_wall: '🧱',
  demon_slayer: '😈',
  clutch_factor: '🎯',
  unstoppable: '💪',
  char_legend: '🐉',
  roster_master: '📚',
  old_reliable: '🔁',
  jack_of_all: '🃏',
  bronze_bomber: '🥉',
  silver_lining: '🥈',
  flawless_run: '✨',
  executioner: '🗡️',
  tax_collector: '💰',
  pacifist: '🕊️',
  sacrificer: '🩸',
};

export const PRIVATE_BADGES = new Set(['punching_bag']);

export const CHAR_EMOJIS: Record<string, string> = {
  Mario: '🍄', 'Donkey Kong': '🦍', Link: '🗡️', Samus: '🚀', 'Dark Samus': '☄️', Yoshi: '🦕', Kirby: '⭐', Fox: '🦊',
  Pikachu: '⚡', Luigi: '👻', Ness: '🎮', 'Captain Falcon': '🏎️', Jigglypuff: '🎵', Peach: '🍑', Daisy: '🌼', Bowser: '🐢',
  'Ice Climbers': '❄️', Sheik: '🌙', Zelda: '🔮', 'Dr. Mario': '💊', Pichu: '🐭', Falco: '🦅', Marth: '🗡️', Lucina: '💙',
  'Young Link': '🏹', Ganondorf: '👹', Mewtwo: '🔮', Roy: '🔥', Chrom: '⚔️', 'Mr. Game & Watch': '🕹️', 'Meta Knight': '🌀',
  Pit: '😇', 'Dark Pit': '😈', 'Zero Suit Samus': '🔫', Wario: '💰', Snake: '💣', Ike: '🔥', 'Pokémon Trainer': '🎒',
  'Diddy Kong': '🍌', Lucas: '🌟', Sonic: '💨', 'King Dedede': '🔨', Olimar: '🌸', Lucario: '💙', 'R.O.B.': '🤖',
  'Toon Link': '🌊', Wolf: '🐺', Villager: '🌳', 'Mega Man': '⚙️', 'Wii Fit Trainer': '🧘', 'Rosalina & Luma': '✨',
  'Little Mac': '🥊', Greninja: '💧', 'Mii Brawler': '👊', 'Mii Swordfighter': '🗡️', 'Mii Gunner': '🔫', Palutena: '✨',
  'Pac-Man': '🟡', Robin: '📖', Shulk: '🔮', 'Bowser Jr.': '🖌️', 'Duck Hunt': '🦆', Ryu: '🥋', Ken: '🥊', Cloud: '⚡',
  Corrin: '🐉', Bayonetta: '💜', Inkling: '🦑', Ridley: '🦎', Simon: '⛓️', Richter: '💫', 'King K. Rool': '🐊',
  Isabelle: '🎣', Incineroar: '🔥', 'Piranha Plant': '🌿', Joker: '🃏', Hero: '⚔️', 'Banjo & Kazooie': '🐦', Terry: '👊',
  Byleth: '🏫', 'Min Min': '🍜', Steve: '⛏️', Sephiroth: '🖤', 'Pyra/Mythra': '🔥', Kazuya: '👿', Sora: '🔑',
};

export interface BadgeInfo {
  id: string;
  label: string;
  color: string;
}

type BadgeMap = Record<string, BadgeInfo>;

let badgesReady = false;
let badgesCache: BadgeMap = {};
let badgesPromise: Promise<BadgeMap> | null = null;

export function loadAllBadges(): Promise<BadgeMap> {
  if (badgesReady) return Promise.resolve(badgesCache);
  if (badgesPromise) return badgesPromise;
  // Imported lazily to avoid a circular import with api.ts at module-init time.
  badgesPromise = import('./api').then(({ apiGet }) =>
    apiGet<BadgeMap>('/users/badges/all')
      .then((data) => {
        badgesCache = data || {};
        badgesReady = true;
        return badgesCache;
      })
      .catch(() => {
        badgesCache = {};
        badgesReady = true;
        return badgesCache;
      })
  );
  return badgesPromise;
}

function badgeIconEmoji(b: BadgeInfo): string {
  return BADGE_ICONS[b.id] || '🏅';
}

export function badgeIcon(badges: BadgeMap, username: string): string {
  const b = badges[username];
  if (!b || PRIVATE_BADGES.has(b.id)) return '';
  return badgeIconEmoji(b);
}

// Full pill: colored badge with icon + label. JSX equivalent of badgePill().
export function BadgePill({ badges, username }: { badges: BadgeMap; username: string }) {
  const b = badges[username];
  if (!b || PRIVATE_BADGES.has(b.id)) return null;
  return (
    <span
      title={b.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        background: b.color + '22',
        border: `1px solid ${b.color}55`,
        color: b.color,
        borderRadius: 10,
        padding: '1px 7px',
        fontSize: '0.68rem',
        fontWeight: 700,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      }}
    >
      {badgeIconEmoji(b)} {b.label}
    </span>
  );
}
