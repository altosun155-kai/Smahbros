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

// "How to earn" copy, used by the profile page's badge detail modal.
// Doesn't exist in the legacy badge-data.js/badges.js -- profile.html is the
// only page that needs it, so it's new content here, not a port of a
// duplicate the legacy site already had.
export const BADGE_HOW: Record<string, string> = {
  specialist: 'Score 30+ points with a single character.',
  allrounder: 'Score points with 10 or more different characters.',
  consistent: 'Maintain 20+ points on 5 or more characters simultaneously.',
  champion: 'Win a tournament.',
  serial_champ: 'Win 6 or more tournaments.',
  tourney_king: 'Have the most tournament wins globally.',
  top3: 'Hold the #1 spot on the character Elo leaderboard (1100+ Elo).',
  veteran: 'Play 60 or more recorded matches.',
  finisher: 'Land more 3-stocks (perfect wins) than anyone else globally (minimum 10).',
  punching_bag: 'Get 3-stocked more than anyone else globally (minimum 10 times).',
  the_wall: 'Win 80% or more of your last 20 matches.',
  demon_slayer: 'Defeat the player currently ranked #1 on the leaderboard at least 3 times.',
  clutch_factor: 'Win 8 consecutive matches, all decided on the last stock.',
  unstoppable: 'Reach a power-weighted Elo average of 1150+ across all characters (20+ games played).',
  char_legend: 'Reach 1350+ Elo on a single character.',
  roster_master: 'Hold the most points with 20 or more different characters globally.',
  old_reliable: 'Play 200 total matches with your single most-used character.',
  jack_of_all: 'Win at least 10 matches with 20 different characters.',
  bronze_bomber: 'Finish in 3rd place in 6 separate tournaments.',
  silver_lining: 'Finish in 2nd place in 6 separate tournaments.',
  flawless_run: 'Win a tournament without losing a single recorded match.',
  executioner: 'Directly eliminate the defending champion in the very next tournament.',
  tax_collector: 'Accumulate 300 or more total kills across all matches.',
  pacifist: 'Have the lowest average kills per match globally while still having 15+ wins.',
  sacrificer: 'Make the most sacrifices globally in teams tournaments (minimum 5).',
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
