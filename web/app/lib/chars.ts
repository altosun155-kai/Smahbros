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

// Unlike CHAR_FILE_OVERRIDES, the icon (chara_2) exports were uploaded with
// their own, inconsistent naming choices -- not just the full-portrait
// filename plus "_icon". Confirmed against the live Supabase bucket
// (HEAD-equivalent checks against every entry here and every no-entry
// default for a punctuation/space-bearing roster name) after the mobile
// "More fighters" modal work shipped a broken slot-box image for Bowser Jr.:
// four entries below were wrong in the exact same way (a plausible-looking
// filename that isn't the real one), and three more (the Miis) were
// needless -- the unadorned default (name + "_icon.png") already matches
// and the override was actively pointing at the wrong asset instead.
// This was a pre-existing data bug, not introduced by the port: the
// identical wrong values were already present in web/public/js/chars.js,
// the legacy vanilla file this was originally ported from -- porting it
// "byte-identical" carried the bug forward rather than catching it. That
// file has since been deleted (see the header comment above) rather than
// left around as a bad template.
//
// Audited against the live bucket afterward (scratch script, not
// committed): with these 7 fixed, 0 entries below point at a missing file,
// but 7 of the remaining 9 are now provably redundant -- their value is
// byte-identical to what the default rule (name + "_icon.png") already
// produces on its own. Only 'Pokémon Trainer' and 'Pyra/Mythra' need a real
// override (the default rule can't reproduce "é" or "/" in a filename).
// Left as-is pending a decision on whether to shrink the table down to
// those two -- noted here so that decision has the evidence next to it.
export const CHAR_HEAD_OVERRIDES: Record<string, string> = {
  'Pokémon Trainer':  'Pokemon Trainer_icon.png',
  'Rosalina & Luma':  'Rosalina & Luma_icon.png',    // was "Rosalina and Luma_icon.png" -- real file keeps the ampersand, unlike the full portrait
  'Pac-Man':          'Pac-Man_icon.png',            // was "Pac Man_icon.png" -- real file keeps the hyphen, unlike the full portrait
  'Bowser Jr.':       'Bowser Jr._icon.png',         // was "Bowser Jr_icon.png" -- real file keeps the period, unlike the full portrait
  'King K. Rool':     'King K. Rool_icon.png',
  'Banjo & Kazooie':  'Banjo & Kazooie_icon.png',
  'Pyra/Mythra':      'Pyra Mythra_icon.png',
  'R.O.B.':           'R.O.B._icon.png',
  'Wii Fit Trainer':  'Wii Fit Trainer_icon.png',    // was "WII Fit Trainer_icon.png" -- real file uses normal case, unlike the full portrait
  // Mii Brawler/Swordfighter/Gunner: no entry needed -- the icon exports use
  // the plain display name ("Mii Brawler_icon.png", etc.), not the
  // Mii_fighter/_sword/_gunner naming the full-portrait override uses. The
  // removed entries pointed at Mii_fighter_icon.png etc., which don't exist.
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
