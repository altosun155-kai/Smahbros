// chars.js — shared Smash Ultimate roster data and character image URLs

const SUPABASE_CHARS = 'https://oqtdlertvgmopnibrbiu.supabase.co/storage/v1/object/public/Characters/';

// Overrides for characters whose filename differs from their display name
const CHAR_FILE_OVERRIDES = {

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

// Characters with no image in Supabase
const CHAR_NO_IMAGE = new Set([]);

// Stock icon overrides (chara_2 exports) — only needed when filename differs
const CHAR_HEAD_OVERRIDES = {
  'Pokémon Trainer':  'Pokemon Trainer_icon.png',
  'Rosalina & Luma':  'Rosalina and Luma_icon.png',
  'Pac-Man':          'Pac Man_icon.png',
  'Bowser Jr.':       'Bowser Jr_icon.png',
  'King K. Rool':     'King K. Rool_icon.png',
  'Banjo & Kazooie':  'Banjo & Kazooie_icon.png',
  'Pyra/Mythra':      'Pyra Mythra_icon.png',
  'R.O.B.':           'R.O.B._icon.png',
  'Wii Fit Trainer':  'WII Fit Trainer_icon.png',
  'Mii Brawler':      'Mii_fighter_icon.png',
  'Mii Swordfighter': 'Mii_sword_icon.png',
  'Mii Gunner':       'Mii_gunner_icon.png',
};

// Returns the stock-icon (chara_2) URL for a character, falls back to full portrait.
function charHeadUrl(name) {
  if (CHAR_NO_IMAGE.has(name)) return charImgUrl(name);
  const filename = CHAR_HEAD_OVERRIDES[name] || (name + '_icon.png');
  return SUPABASE_CHARS + encodeURIComponent(filename);
}

function charImgUrl(name) {
  if (CHAR_NO_IMAGE.has(name)) return '';
  const filename = CHAR_FILE_OVERRIDES[name] || (name + '.png');
  return SUPABASE_CHARS + encodeURIComponent(filename);
}

// Returns the alt portrait URL (e.g. alt=1 → "Mario_1.png").
// Falls back to the base portrait if the alt image hasn't been uploaded yet.
function charAltImgUrl(name, alt) {
  if (!alt && alt !== 0) return charImgUrl(name);
  const safeName = name
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // é → e (matches upload script)
    .replace(/\//g, ' ');                               // Pyra/Mythra → Pyra Mythra
  return SUPABASE_CHARS + encodeURIComponent(safeName + '_' + alt + '.png');
}

const SMASH_ROSTER = [
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
