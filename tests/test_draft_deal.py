import random

import pytest

from routers.draft import _build_free_pool_bracket, _deal_bracket, _next_power_of_two


def _entries(player_ids, chars_per_player):
    return {
        pid: [{"player_id": pid, "character": f"P{pid}C{i}"} for i in range(chars_per_player)]
        for pid in player_ids
    }


def test_group_distinctness():
    for n in (2, 3, 4):
        for c in (1, 4, 8):
            group_size = _next_power_of_two(n)
            for _ in range(300):
                seeds = _deal_bracket(_entries(range(1, n + 1), c), c)
                for start in range(0, len(seeds), group_size):
                    group = seeds[start:start + group_size]
                    ids = [s["player_id"] for s in group if s is not None]
                    assert len(ids) == len(set(ids)), f"n={n} c={c} group={group}"


def test_no_self_match_round1_and_round2():
    for n in (3, 4):
        for c in (1, 4, 8):
            group_size = _next_power_of_two(n)
            for _ in range(150):
                seeds = _deal_bracket(_entries(range(1, n + 1), c), c)
                for start in range(0, len(seeds), group_size):
                    group = seeds[start:start + group_size]
                    round0_winners = []
                    for i in range(0, len(group), 2):
                        a, b = group[i], group[i + 1]
                        if a is not None and b is not None:
                            assert a["player_id"] != b["player_id"], f"round-0 self-match: n={n} c={c}"
                        round0_winners.append(b if a is None else (a if b is None else random.choice([a, b])))
                    for i in range(0, len(round0_winners), 2):
                        if i + 1 >= len(round0_winners):
                            break
                        wa, wb = round0_winners[i], round0_winners[i + 1]
                        if wa is not None and wb is not None:
                            assert wa["player_id"] != wb["player_id"], f"round-1 self-match: n={n} c={c}"


def test_pairing_distribution_n4():
    # n=4, c=1: one group, two round-0 pairs, three possible partitions of the
    # four players into those two pairs. A fixed (non-shuffled) player order
    # would collapse this to one partition happening ~100% of the time.
    counts = {"AB_CD": 0, "AC_BD": 0, "AD_BC": 0}
    trials = 6000
    for _ in range(trials):
        seeds = _deal_bracket(_entries(["A", "B", "C", "D"], 1), 1)
        pair1 = frozenset([seeds[0]["player_id"], seeds[1]["player_id"]])
        if pair1 in (frozenset({"A", "B"}), frozenset({"C", "D"})):
            counts["AB_CD"] += 1
        elif pair1 in (frozenset({"A", "C"}), frozenset({"B", "D"})):
            counts["AC_BD"] += 1
        else:
            counts["AD_BC"] += 1
    for key, cnt in counts.items():
        frac = cnt / trials
        assert 0.25 < frac < 0.41, f"{key} occurred {frac:.3f} of the time, expected ~0.333 -- player order may not be random"


def test_entry_and_bye_counts():
    for n in (2, 3, 4):
        for c in (1, 4, 8):
            group_size = _next_power_of_two(n)
            seeds = _deal_bracket(_entries(range(1, n + 1), c), c)
            assert len(seeds) == c * group_size
            assert sum(1 for s in seeds if s is not None) == n * c
            assert sum(1 for s in seeds if s is None) == c * (group_size - n)


def test_character_distributed_across_groups():
    # Test 3 catches a fixed *player* order; this catches a fixed *character*
    # order one level down -- deleting the per-player pool shuffle would still
    # pass every test above (group distinctness, counts, and pairing
    # distribution don't care *which* of a player's characters lands where),
    # yet a given player's slot-0 character would land in group 0 forever.
    n, c = 3, 4
    group_size = _next_power_of_two(n)
    group_indices_seen = set()
    for _ in range(400):
        seeds = _deal_bracket(_entries(range(1, n + 1), c), c)
        for idx, s in enumerate(seeds):
            if s is not None and s["player_id"] == 1 and s["character"] == "P1C0":
                group_indices_seen.add(idx // group_size)
                break
    assert len(group_indices_seen) > 1, "player 1's first character always landed in the same group -- pool shuffle may be missing"


def test_guard_rails_raise_not_crash():
    with pytest.raises(ValueError):
        _deal_bracket(_entries([1], 3), 3)  # chars_per_player not a power of two

    with pytest.raises(ValueError):
        mismatched = _entries([1, 2], 4)
        mismatched[2] = mismatched[2][:3]  # player 2 short one pick
        _deal_bracket(mismatched, 4)

    with pytest.raises(ValueError):
        _build_free_pool_bracket([None, None], {})  # bye vs bye
