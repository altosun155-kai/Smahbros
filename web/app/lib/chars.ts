// chars.ts — was originally a byte-identical logic port of
// web/public/js/chars.js; that file is now deleted (see git history for its
// last content). It held 7 wrong CHAR_HEAD_OVERRIDES entries that porting
// "byte-identical" carried straight into this file -- the exact failure the
// old header comment here was trying to guard against ("re-deriving them
// risks reintroducing that bug"), except the source being copied from was
// itself already wrong. Its pages were redirect-archived and unreachable by
// URL (see CLAUDE.md's next.config.js redirects), so nothing live referenced
// it; deleted rather than left as a bad template for the next port.

export const SUPABASE_CHARS = 'https://oqtdlertvgmopnibrbiu.supabase.co/storage/v1/object/public/Characters/';

export const CHAR_FILE_OVERRIDES: Record<string, string> = {
  'Pokémon Trainer':  'Pokemon Trainer.png',
  'Rosalina & Luma':  'Rosalina and Luma.png',
  'Pac-Man':          'Pac Man.png',
  'Bowser Jr.':       'Bowser Jr.png',
  'King K. Rool':     'King K Rool.png',
  'Banjo & Kazooie':  'Banjo and Kazooie.png',
  'Pyra/Mythra':      'Pyra Mythra.png',
  'R.O.B.':           'R.O.B..png',
  'Wii Fit Trainer':  'WII Fit Trainer.png',
  'Mii Brawler':      'Mii_fighter.png',
  'Mii Swordfighter': 'Mii_sword.png',
  'Mii Gunner':       'Mii_gunner.png',
};

export const CHAR_NO_IMAGE: Set<string> = new Set([]);

// The rule: every icon (chara_2) export in the bucket is named
// "<display name>_icon.png", verbatim, for the ENTIRE roster except the two
// names below -- including every name with an ampersand or a period
// (Banjo & Kazooie, Mr. Game & Watch, R.O.B., King K. Rool, Bowser Jr., ...).
// Punctuation that's a normal filename character passes through fine; only
// a name containing something that literally can't appear in a filename
// needs an override at all. That's the whole rule -- assuming otherwise
// (that punctuation in general was the risk) is exactly what produced 7
// wrong entries here previously: real fixes for real bugs, but guesses
// rather than checks, on names that turned out not to need fixing in the
// first place. Audited against the live bucket (scratch script, not
// committed) to confirm: with only these two entries, every one of the
// other 83 roster names still resolves via the default rule alone.
export const CHAR_HEAD_OVERRIDES: Record<string, string> = {
  'Pokémon Trainer': 'Pokemon Trainer_icon.png', // "é" can't appear in the uploaded filename
  'Pyra/Mythra':      'Pyra Mythra_icon.png',    // "/" can't appear in a filename at all
};

export function charImgUrl(name: string): string {
  if (CHAR_NO_IMAGE.has(name)) return '';
  const filename = CHAR_FILE_OVERRIDES[name] || name + '.png';
  return SUPABASE_CHARS + encodeURIComponent(filename);
}

// Returns the stock-icon (chara_2) URL for a character, falls back to full portrait.
export function charHeadUrl(name: string): string {
  if (CHAR_NO_IMAGE.has(name)) return charImgUrl(name);
  const filename = CHAR_HEAD_OVERRIDES[name] || name + '_icon.png';
  return SUPABASE_CHARS + encodeURIComponent(filename);
}

// Returns the alt portrait URL (e.g. alt=1 -> "Mario_1.png").
// Falls back to the base portrait if the alt image hasn't been uploaded yet.
export function charAltImgUrl(name: string, alt: number | null | undefined): string {
  if (!alt && alt !== 0) return charImgUrl(name);
  const safeName = name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // strip combining diacritics (matches upload script)
    .replace(/\//g, ' ');                               // Pyra/Mythra -> Pyra Mythra
  return SUPABASE_CHARS + encodeURIComponent(safeName + '_' + alt + '.png');
}

export const SMASH_ROSTER: string[] = [
  'Mario','Donkey Kong','Link','Samus','Dark Samus','Yoshi','Kirby','Fox','Pikachu',
  'Luigi','Ness','Captain Falcon','Jigglypuff','Peach','Daisy','Bowser','Ice Climbers',
  'Sheik','Zelda','Dr. Mario','Pichu','Falco','Marth','Lucina','Young Link','Ganondorf',
  'Mewtwo','Roy','Chrom','Mr. Game & Watch','Meta Knight','Pit','Dark Pit',
  'Zero Suit Samus','Wario','Snake','Ike','Pokémon Trainer','Diddy Kong','Lucas',
  'Sonic','King Dedede','Olimar','Lucario','R.O.B.','Toon Link','Wolf','Villager',
  'Mega Man','Wii Fit Trainer','Rosalina & Luma','Little Mac','Greninja','Mii Brawler',
  'Mii Swordfighter','Mii Gunner','Palutena','Pac-Man','Robin','Shulk','Bowser Jr.',
  'Duck Hunt','Ryu','Ken','Cloud','Corrin','Bayonetta','Inkling','Ridley','Simon',
  'Richter','King K. Rool','Isabelle','Incineroar','Piranha Plant','Joker','Hero',
  'Banjo & Kazooie','Terry','Byleth','Min Min','Steve','Sephiroth','Pyra/Mythra',
  'Kazuya','Sora',
];
