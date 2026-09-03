"""Find brackets whose Grand Final was actually completed (round_winners has
a real entry for the true final match) but never got a `winner`/placements,
because the old isGrandFinal condition in web/app/tournament/page.tsx could
miss it (fixed in this same change -- see CLAUDE.md's Known Gaps).

DRY RUN ONLY. Prints every proposed change -- bracket id/name, the derived
tournament winner, and each placement's player/character/elo_bonus -- and
writes nothing. Elo is a stored, mutated-in-place column (also documented in
CLAUDE.md), so applying this is one-way; review the printed output first.
Actually writing the changes is a deliberately separate, not-yet-built step
(see bottom of this file) -- run this, read the output, decide, then ask for
the apply path to be added.

Usage:
    DATABASE_URL=<real prod connection string> python scripts/backfill_grand_final_placements.py

Reuses the exact same helpers routers/brackets.py's real /brackets/{id}/end
endpoint uses (_parse_label, _compute_round_participants) and mirrors its
placement/bonus math exactly, rather than re-deriving it here and risking
drift between the two.
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import Bracket, User, SessionLocal
from routers.brackets import _parse_label, _compute_round_participants


def expected_gf_round_index(bracket_data_len: int) -> int:
    """Mirrors end_tournament's own bit-walk exactly (routers/brackets.py) --
    bracket_data is always padded to a power of two, so the Grand Final is at
    round index log2(len)."""
    ri = 0
    n = bracket_data_len
    while n > 1:
        n >>= 1
        ri += 1
    return ri


def main():
    db = SessionLocal()
    try:
        candidates = (
            db.query(Bracket)
            .filter(Bracket.winner.is_(None), Bracket.bracket_data.isnot(None))
            .all()
        )

        found_any = False
        for b in candidates:
            if not b.bracket_data or not b.round_winners:
                continue

            gf_ri = expected_gf_round_index(len(b.bracket_data))
            gf_key = f"r{gf_ri}_m0"
            gf_winner_label = (b.round_winners or {}).get(gf_key, "")

            # Not actually complete -- the true final genuinely has no
            # recorded result yet. Not our bug, skip.
            if not gf_winner_label or " — " not in gf_winner_label:
                continue

            found_any = True
            num_players = len(b.players or [])
            k = num_players * 4  # matches end_tournament's k = num_players * 4

            rw = b.round_winners
            participants = _compute_round_participants(b.bracket_data, rw)
            max_ri = gf_ri

            print(f"\n=== Bracket {b.id} — {b.name!r} (host_id={b.user_id}, is_live={b.is_live}) ===")
            print(f"  Grand Final key: {gf_key}  ->  {gf_winner_label}")

            gf_winner_player, gf_winner_char = _parse_label(gf_winner_label)
            proposed = []
            if gf_winner_player:
                proposed.append((gf_winner_player, gf_winner_char, round(k * 1.0), "1st"))

            gf_a_label, gf_b_label = participants.get(max_ri, {}).get(0, ("", ""))
            gf_a_player, gf_a_char = _parse_label(gf_a_label)
            gf_b_player, gf_b_char = _parse_label(gf_b_label)
            if gf_winner_player:
                if gf_a_player and gf_a_player != gf_winner_player:
                    proposed.append((gf_a_player, gf_a_char, round(k * 0.5), "2nd"))
                elif gf_b_player and gf_b_player != gf_winner_player:
                    proposed.append((gf_b_player, gf_b_char, round(k * 0.5), "2nd"))

            if max_ri > 0:
                sf_matches = participants.get(max_ri - 1, {})
                for sf_mi, (sf_a_label, sf_b_label) in sf_matches.items():
                    sf_winner_label = rw.get(f"r{max_ri-1}_m{sf_mi}", "")
                    sf_winner_player, _ = _parse_label(sf_winner_label)
                    sf_a_player, sf_a_char = _parse_label(sf_a_label)
                    sf_b_player, sf_b_char = _parse_label(sf_b_label)
                    if sf_winner_player:
                        if sf_a_player and sf_a_player != sf_winner_player:
                            proposed.append((sf_a_player, sf_a_char, round(k * 0.25), "3rd"))
                        elif sf_b_player and sf_b_player != sf_winner_player:
                            proposed.append((sf_b_player, sf_b_char, round(k * 0.25), "3rd"))

            print(f"  Proposed Bracket.winner = {gf_winner_player!r}")
            print(f"  Proposed placements + Elo bonuses (k={k}):")
            for player, char, bonus, place in proposed:
                user = db.query(User).filter(User.username == player).first()
                current_elo = user.elo if user else "?"
                print(f"    {place:>4}: {player} ({char})  +{bonus} elo  [current player elo: {current_elo}]")

        if not found_any:
            print("No brackets found with a complete Grand Final but a null winner.")
        else:
            print("\nDry run only -- nothing was written. Review the above, then decide "
                  "whether to build the apply step (this script has no write path yet).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
