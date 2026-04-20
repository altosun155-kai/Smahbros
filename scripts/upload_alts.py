"""
Upload Smash Ultimate alt portraits to Supabase.

Usage:
  python upload_alts.py --input /path/to/character/folders --key YOUR_SERVICE_ROLE_KEY

It scans recursively for chara_3_*_0?.png files, maps internal names to
display names, renames them to e.g. "Mario_1.png" … "Mario_8.png", and
uploads them to the existing Characters bucket in Supabase.
"""

import argparse
import re
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")

# ── Supabase config ───────────────────────────────────────────────────────────

SUPABASE_URL    = "https://oqtdlertvgmopnibrbiu.supabase.co"
SUPABASE_BUCKET = "Characters"

# ── Internal name → display name ─────────────────────────────────────────────

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
    "sheik":       "Sheik",
    "zelda":       "Zelda",
    "drmario":     "Dr. Mario",
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
    "wiifit":      "Wii Fit Trainer",
    "rosetta":     "Rosalina & Luma",
    "littlemac":   "Little Mac",
    "gekkouga":    "Greninja",
    "miifighter":  "Mii Brawler",
    "miisword":    "Mii Swordfighter",
    "miigun":      "Mii Gunner",
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
    "elight":      "Pyra/Mythra",  # same slot, skip dupes
    "demon":       "Kazuya",
    "trails":      "Sora",
}

# ── File discovery ────────────────────────────────────────────────────────────

PATTERN = re.compile(r"^chara_3_(.+?)_(\d{2})\.png$", re.IGNORECASE)


def find_alt_files(root: Path) -> list[tuple[Path, str, int]]:
    """Return list of (path, display_name, alt_1_indexed) for all chara_3 alts."""
    results = []
    seen_display = set()

    for f in sorted(root.rglob("chara_3_*.png")):
        m = PATTERN.match(f.name)
        if not m:
            continue
        internal = m.group(1).lower()
        alt_zero = int(m.group(2))  # 00-07
        alt_one  = alt_zero + 1     # 1-8 (our UI convention)

        display = INTERNAL_TO_DISPLAY.get(internal)
        if not display:
            print(f"  [SKIP] unknown internal name: {internal!r}  ({f.name})")
            continue

        # Skip the second Pyra/Mythra file (elight) to avoid overwriting eflame
        key = (display, alt_one)
        if key in seen_display:
            continue
        seen_display.add(key)

        results.append((f, display, alt_one))

    return results


# ── Supabase upload ───────────────────────────────────────────────────────────

def upload_file(path: Path, dest_name: str, service_key: str, dry_run: bool) -> bool:
    url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_BUCKET}/{requests.utils.quote(dest_name)}"
    if dry_run:
        print(f"  [DRY] would upload → {dest_name}")
        return True
    headers = {
        "Authorization": f"Bearer {service_key}",
        "apikey":        service_key,
        "Content-Type":  "image/png",
        "x-upsert":      "true",
    }
    with open(path, "rb") as fh:
        resp = requests.post(url, headers=headers, data=fh, timeout=30)
    if resp.status_code in (200, 201):
        print(f"  [OK]  {dest_name}")
        return True
    else:
        print(f"  [ERR] {dest_name}  →  {resp.status_code} {resp.text[:120]}")
        return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Upload Smash alt portraits to Supabase")
    parser.add_argument("--input",   required=True,  help="Root folder containing character sub-folders")
    parser.add_argument("--key",     default="",     help="Supabase service role key")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be uploaded without actually uploading")
    args = parser.parse_args()

    if not args.dry_run and not args.key:
        sys.exit("Provide --key (service role key) or use --dry-run to preview.")

    root = Path(args.input).expanduser().resolve()
    if not root.is_dir():
        sys.exit(f"Input folder not found: {root}")

    files = find_alt_files(root)
    if not files:
        sys.exit("No chara_3_*_0?.png files found. Check --input path.")

    print(f"Found {len(files)} alt images across {len({d for _,d,_ in files})} characters.\n")

    ok = fail = 0
    for path, display, alt in files:
        dest = f"{display}_{alt}.png"
        if upload_file(path, dest, args.key, args.dry_run):
            ok += 1
        else:
            fail += 1

    print(f"\nDone. {ok} uploaded, {fail} failed.")


if __name__ == "__main__":
    main()
