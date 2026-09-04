"""Find brackets whose Grand Final was actually completed (round_winners has
a real entry for the true final match) but never got placements, from either
of two distinct causes:

  1. `Bracket.winner` itself was never set -- the original isGrandFinal bug in
     web/app/tournament/page.tsx and web/app/bracket/page.tsx (fixed).
  2. `Bracket.winner` IS set correctly (the isGrandFinal fix is working) but
     `Bracket.placements` is still null/empty, and `Bracket.is_live` is still
     True -- because placements and is_live used to only ever get cleared in
     end_tournament (PATCH /brackets/{id}/end), a separate, host-triggered
     action from the PATCH /winner call that sets `winner`. Confirmed live
     via Bracket 91 (Draft #9): winner = 'kai', placements = NULL, is_live
     still True (so it sat in GET /brackets/live and the home page's
     "Continue" panel despite being over). Both are now fixed to happen
     automatically inside set_bracket_winner the instant `tournament_winner`
     is set (see CLAUDE.md) -- brackets found by this script predate that
     fix, so it never ran for them.

Originally only checked for cause 1 (filtered on `winner IS NULL`), which
silently missed cause 2 entirely -- bracket 91 has a real winner, so the old
filter never even looked at it. Widened to catch both: any bracket whose
Grand Final round_winners entry is real, with placements still null/empty,
regardless of whether `winner` happens to already be set. Also flags/clears
`is_live` for any target still marked True, matching set_bracket_winner's
current behavior exactly.

Default is DRY RUN: prints every proposed change -- bracket id/name, the
derived tournament winner, is_live, and each placement's
player/character/elo_bonus -- and writes nothing.

Pass --apply to actually write: sets Bracket.winner (if not already set),
clears Bracket.is_live (if still True), and calls the same _award_placements
routers/brackets.py's set_bracket_winner/end_tournament call -- so a
backfilled bracket gets exactly what a freshly-completed one would, not a
second, potentially-drifting reimplementation of the same math.
Bracket.placements_awarded_at (the field any activity feed/Elo history
actually sorts on -- see routers/matches.py's char_elo_history) is set to
one second after this bracket's own last recorded MatchResult, NOT "now"
(the moment this script happens to run) and NOT created_at (when the
bracket was STARTED) -- confirmed live via Draft #9 and bracket 4, both
showing their placement row sorted above the matches that earned it because
created_at was the only timestamp placements had before this column
existed. Elo is a stored, mutated-in-place column (documented in
CLAUDE.md) -- applying this is one-way, there is no undo. Each bracket is
committed and printed immediately after being applied, so a run that's
interrupted partway leaves a clean, auditable trail of exactly what was and
wasn't written.

Usage:
    DATABASE_URL=<real prod connection string> python scripts/backfill_grand_final_placements.py
    DATABASE_URL=<real prod connection string> python scripts/backfill_grand_final_placements.py --apply

Reuses the exact same helpers routers/brackets.py's real endpoints use
(_parse_label, _compute_round_participants, _placement_bonus_k,
_award_placements) rather than re-deriving any of it here and risking drift
between the two.
"""
import argparse
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import timedelta

from database import Bracket, User, CharacterStats, MatchResult, SessionLocal
from routers.brackets import (
    _parse_label,
    _compute_round_participants,
    _has_real_placements,
    _placement_bonus_k,
    _award_placements,
)
from routers.matches import ELO_DEFAULT


def _placements_awarded_at_for_backfill(db, bracket: Bracket):
    """Timestamp to backfill Bracket.placements_awarded_at with: one second
    after the bracket's own last recorded MatchResult (the Grand Final, for
    a bracket that actually completed one), so the placement row sorts
    right after the matches that earned it instead of at the bracket's
    created_at (when it was STARTED, not when it finished) -- the bug this
    whole backfill exists to fix, confirmed live via Draft #9 and bracket 4.
    Falls back to created_at only if this bracket has no MatchResult rows at
    all (no live path ever writes placements_awarded_at without a real last
    match to anchor to, so this fallback is backfill-only)."""
    last_match = (
        db.query(MatchResult)
        .filter(MatchResult.bracket_id == bracket.id)
        .order_by(MatchResult.created_at.desc())
        .first()
    )
    if last_match:
        return last_match.created_at + timedelta(seconds=1), False
    return bracket.created_at, True  # (timestamp, used_fallback)


def expected_gf_round_index(bracket_data_len: int) -> int:
    """Mirrors end_tournament's/_award_placements's own bit-walk exactly --
    bracket_data is always padded to a power of two, so the Grand Final is at
    round index log2(len)."""
    ri = 0
    n = bracket_data_len
    while n > 1:
        n >>= 1
        ri += 1
    return ri


def _iter_candidates(db):
    """Yield (bracket, gf_key, gf_winner_label, gf_ri) for every bracket that
    needs backfilling -- shared detection logic for both dry-run and apply,
    so the two can never look at a different set of brackets."""
    candidates = (
        db.query(Bracket)
        .filter(Bracket.bracket_data.isnot(None))
        .order_by(Bracket.id)
        .all()
    )
    for b in candidates:
        if not b.bracket_data or not b.round_winners:
            continue
        if _has_real_placements(b):
            continue  # already has real placements (e.g. bracket 21) -- not a target

        gf_ri = expected_gf_round_index(len(b.bracket_data))
        gf_key = f"r{gf_ri}_m0"
        gf_winner_label = (b.round_winners or {}).get(gf_key, "")

        # Not actually complete -- the true final genuinely has no recorded
        # result yet. Not our bug, skip.
        if not gf_winner_label or " — " not in gf_winner_label:
            continue

        yield b, gf_key, gf_winner_label, gf_ri


def _current_character_elo(db, player: str, char: str):
    """Read-only lookup of a character's current stored Elo, for the audit
    printout -- deliberately not _get_or_create_stat, which would create and
    dirty a new zero-games row as a side effect of just printing. ELO_DEFAULT
    (not created yet) matches what _get_or_create_stat would initialize it
    to the first time this character is actually touched."""
    user = db.query(User).filter(User.username == player).first()
    if not user:
        return "?"
    stat = db.query(CharacterStats).filter_by(user_id=user.id, character=char).first()
    return stat.elo if stat and stat.elo is not None else ELO_DEFAULT


def _derive_proposed(b: Bracket, gf_key: str, gf_winner_label: str, gf_ri: int):
    """Re-derive winner + placements independently of _award_placements, for
    the audit printout -- side-effect-free (no session mutation), so dry-run
    can call this freely. Mirrors _award_placements's own math exactly; used
    in apply mode too, to print what SHOULD happen before actually calling
    _award_placements, and to sanity-check the two agree."""
    k = _placement_bonus_k(len(b.bracket_data))
    rw = b.round_winners
    participants = _compute_round_participants(b.bracket_data, rw)
    max_ri = gf_ri

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

    return gf_winner_player, k, proposed


def main(apply: bool):
    db = SessionLocal()
    try:
        found_any = False
        for b, gf_key, gf_winner_label, gf_ri in _iter_candidates(db):
            found_any = True
            was_live = b.is_live
            gf_winner_player, k, proposed = _derive_proposed(b, gf_key, gf_winner_label, gf_ri)

            winner_status = (
                f"already set to {b.winner!r} -- only placements/Elo are missing"
                if b.winner else "NULL -- both winner and placements are missing"
            )
            verb = "Applied" if apply else "Proposed"
            print(f"\n=== Bracket {b.id} — {b.name!r} (host_id={b.user_id}, is_live={b.is_live}) ===")
            print(f"  Bracket.winner: {winner_status}")
            if was_live:
                # set_bracket_winner now clears this the instant a Grand
                # Final resolves (see CLAUDE.md) -- these brackets predate
                # that fix, so it never ran. Still is_live=True means they
                # sit in GET /brackets/live and the home page's "Continue"
                # panel despite being over -- found live via Bracket 91
                # (Draft #9), which showed exactly this.
                print(f"  Bracket.is_live: True -- {verb.lower()} change: False (tournament is actually over)")
            print(f"  Grand Final key: {gf_key}  ->  {gf_winner_label}")
            print(f"  {verb} Bracket.winner = {gf_winner_player!r}")
            print(f"  {verb} placements + Elo bonuses (k={k}):")
            for player, char, bonus, place in proposed:
                current_elo = _current_character_elo(db, player, char)
                print(f"    {place:>4}: {player} ({char})  +{bonus} elo  [current elo before: {current_elo}]")

            awarded_at, used_fallback = _placements_awarded_at_for_backfill(db, b)
            print(f"  {verb} placements_awarded_at = {awarded_at.isoformat()}"
                  + ("  (fallback: no MatchResult rows found for this bracket, used created_at)" if used_fallback else "  (1s after this bracket's last recorded match)"))

            if not apply:
                continue

            # Actually write it -- same call set_bracket_winner makes, so
            # this bracket ends up in exactly the state a freshly-completed
            # one would, not a second, possibly-drifting reimplementation.
            if not b.winner:
                b.winner = gf_winner_player
            if was_live:
                b.is_live = False
            awarded = _award_placements(b, db)
            # _award_placements just stamped placements_awarded_at with
            # "now" (the moment this backfill script happened to run) --
            # correct for a live award, wrong here, since this tournament
            # actually finished whenever its last real match was played.
            # Override with the value computed and printed above.
            b.placements_awarded_at = awarded_at
            db.commit()

            if set(awarded) != set((p, c, bo, pl) for p, c, bo, pl in proposed):
                print("  ⚠️  WARNING: _award_placements's actual result differs from the "
                      "printout above -- the printed values were NOT what got written. "
                      f"Actually applied: {awarded}")
            print(f"  ✅ committed -- Bracket {b.id} updated.")

        if not found_any:
            print("No brackets found with a complete Grand Final but missing placements.")
        elif not apply:
            print("\nDry run only -- nothing was written. Re-run with --apply to write these "
                  "changes for real. Elo is stored and mutated in place -- there is no undo.")
        else:
            print("\nApply complete -- every change printed above was written and committed.")
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually write the changes (Bracket.winner, Bracket.is_live, Bracket.placements, "
             "character Elo). Default is dry-run: print only, write nothing. "
             "Elo is stored and mutated in place -- there is no undo.",
    )
    args = parser.parse_args()
    main(apply=args.apply)
