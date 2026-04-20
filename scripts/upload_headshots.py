"""
Upload Smash Ultimate stock icons (chara_2) to Supabase as *_icon.png files.

Usage:
  python upload_headshots.py --input /path/to/character/folders --key YOUR_SERVICE_ROLE_KEY

Scans recursively for chara_2_*_00.png (default costume only) and uploads
them to the Characters bucket as e.g. "Mario_icon.png".
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

SUPABASE_URL    = "https://oqtdlertvgmopnibrbiu.supabase.co"
SUPABASE_BUCKET = "Characters"

INTERNAL_TO_DISPLAY = {
    "mario":       "Mario",
    "donkey":      "Donkey Kong",
    "link":        "Link",
    "samus":       "Samus",
    "samusd":      "Dark Samus",
    "yoshi":       "Yoshi",
    "kirby":       "Kirby",
    "fox":         "Fox",
    "pikachu":     "Pikachu",
    "luigi":       "Luigi",
    "ness":        "Ness",
    "captain":     "Captain Falcon",
    "purin":       "Jigglypuff",
    "peach":       "Peach",
    "daisy":       "Daisy",
    "koopa":       "Bowser",
    "iceclimber":  "Ice Climbers",
    "ice_climber": "Ice Climbers",
    "sheik":       "Sheik",
    "zelda":       "Zelda",
    "drmario":     "Dr. Mario",
    "mariod":      "Dr. Mario",
    "pichu":       "Pichu",
    "falco":       "Falco",
    "marth":       "Marth",
    "lucina":      "Lucina",
    "younglink":   "Young Link",
    "ganon":       "Ganondorf",
    "mewtwo":      "Mewtwo",
    "roy":         "Roy",
    "chrom":       "Chrom",
    "gamewatch":   "Mr. Game & Watch",
    "metaknight":  "Meta Knight",
    "pit":         "Pit",
    "pitb":        "Dark Pit",
    "szerosuit":   "Zero Suit Samus",
    "wario":       "Wario",
    "snake":       "Snake",
    "ike":         "Ike",
    "ptrainer":    "Pokémon Trainer",
    "diddy":       "Diddy Kong",
    "lucas":       "Lucas",
    "sonic":       "Sonic",
    "dedede":      "King Dedede",
    "pikmin":      "Olimar",
    "lucario":     "Lucario",
    "robot":       "R.O.B.",
    "toonlink":    "Toon Link",
    "wolf":        "Wolf",
    "murabito":    "Villager",
    "megaman":     "Mega Man",
    "rockman":     "Mega Man",
    "wiifit":      "Wii Fit Trainer",
    "rosetta":     "Rosalina & Luma",
    "littlemac":   "Little Mac",
    "gekkouga":    "Greninja",
    "miifighter":  "Mii Brawler",
    "miisword":    "Mii Swordfighter",
    "miiswordsman":"Mii Swordfighter",
    "miigun":      "Mii Gunner",
    "miigunner":   "Mii Gunner",
    "palutena":    "Palutena",
    "pacman":      "Pac-Man",
    "reflet":      "Robin",
    "shulk":       "Shulk",
    "koopajr":     "Bowser Jr.",
    "duckhunt":    "Duck Hunt",
    "ryu":         "Ryu",
    "ken":         "Ken",
    "cloud":       "Cloud",
    "kamui":       "Corrin",
    "bayonetta":   "Bayonetta",
    "inkling":     "Inkling",
    "ridley":      "Ridley",
    "simon":       "Simon",
    "richter":     "Richter",
    "krool":       "King K. Rool",
    "shizue":      "Isabelle",
    "gaogaen":     "Incineroar",
    "packun":      "Piranha Plant",
    "jack":        "Joker",
    "brave":       "Hero",
    "buddy":       "Banjo & Kazooie",
    "dolly":       "Terry",
    "master":      "Byleth",
    "tantan":      "Min Min",
    "pickel":      "Steve",
    "edge":        "Sephiroth",
    "eflame":      "Pyra/Mythra",
    "eflame_first":"Pyra/Mythra",
    "eflame_only": "Pyra/Mythra",
    "elight":      "Pyra/Mythra",
    "elight_first":"Pyra/Mythra",
    "elight_only": "Pyra/Mythra",
    "demon":       "Kazuya",
    "trail":       "Sora",
    "trails":      "Sora",
    "pzenigame":   "Pokémon Trainer",
    "pfushigisou": "Pokémon Trainer",
    "plizardon":   "Pokémon Trainer",
}

# Only the default costume (00) — one icon per character
PATTERN = re.compile(r"^chara_2_(.+?)_00\.png$", re.IGNORECASE)

SAFE_OVERRIDES = {
    "Pokémon Trainer":  "Pokemon Trainer",
    "Rosalina & Luma":  "Rosalina and Luma",
    "Pac-Man":          "Pac Man",
    "Bowser Jr.":       "Bowser Jr",
    "King K. Rool":     "King K Rool",
    "Banjo & Kazooie":  "Banjo and Kazooie",
    "Pyra/Mythra":      "Pyra Mythra",
    "R.O.B.":           "R.O.B.",
    "Wii Fit Trainer":  "WII Fit Trainer",
    "Mii Brawler":      "Mii_fighter",
    "Mii Swordfighter": "Mii_sword",
    "Mii Gunner":       "Mii_gunner",
}


def safe_name(display: str) -> str:
    if display in SAFE_OVERRIDES:
        return SAFE_OVERRIDES[display]
    return unicodedata.normalize('NFKD', display).encode('ascii', 'ignore').decode('ascii').replace('/', ' ')


def find_icon_files(root: Path):
    results = []
    seen = set()
    for f in sorted(root.rglob("chara_2_*.png")):
        m = PATTERN.match(f.name)
        if not m:
            continue
        internal = m.group(1).lower()
        display = INTERNAL_TO_DISPLAY.get(internal)
        if not display:
            print(f"  [SKIP] unknown internal name: {internal!r}  ({f.name})")
            continue
        if display in seen:
            continue
        seen.add(display)
        results.append((f, display))
    return results


def upload_file(path: Path, dest_name: str, service_key: str, dry_run: bool) -> bool:
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{requests.utils.quote(dest_name, safe='')}"
    if dry_run:
        print(f"  [DRY] {path.name}  →  {dest_name}")
        return True
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey":        service_key,
        "Content-Type":  "image/png",
        "x-upsert":      "true",
    }
    for attempt in range(3):
        try:
            with open(path, "rb") as fh:
                resp = requests.post(url, headers=headers, data=fh, timeout=90)
            if resp.status_code in (200, 201):
                print(f"  [OK]  {dest_name}")
                return True
            else:
                print(f"  [ERR] {dest_name}  →  {resp.status_code} {resp.text[:120]}")
                return False
        except requests.exceptions.Timeout:
            if attempt < 2:
                print(f"  [RETRY {attempt+1}] {dest_name} timed out…")
            else:
                print(f"  [ERR] {dest_name}  →  timed out after 3 attempts")
                return False


def main():
    parser = argparse.ArgumentParser(description="Upload Smash stock icons to Supabase")
    parser.add_argument("--input",   required=True,  help="Root folder containing chara_2_*_00.png files")
    parser.add_argument("--key",     default="",     help="Supabase service role key")
    parser.add_argument("--dry-run", action="store_true", help="Preview without uploading")
    args = parser.parse_args()

    if not args.dry_run and not args.key:
        sys.exit("Provide --key (service role key) or use --dry-run to preview.")

    root = Path(args.input).expanduser().resolve()
    if not root.is_dir():
        sys.exit(f"Input folder not found: {root}")

    files = find_icon_files(root)
    if not files:
        sys.exit("No chara_2_*_00.png files found. Check --input path.")

    print(f"Found {len(files)} stock icons.\n")

    ok = fail = 0
    for path, display in files:
        dest = safe_name(display) + "_icon.png"
        if upload_file(path, dest, args.key, args.dry_run):
            ok += 1
        else:
            fail += 1

    print(f"\nDone. {ok} uploaded, {fail} failed.")


if __name__ == "__main__":
    main()
