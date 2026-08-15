import pytest

from routers.brackets import _swap_positions


def _bd(*pairs):
    """Build a bracket_data list from (a, b) tuples."""
    return [{"a": a, "b": b} for a, b in pairs]


def test_swap_two_unplayed_entries_exchanges_positions():
    bracket_data = _bd(
        ("kai — Mario", "leap — Luigi"),
        ("rith — Fox", "vyro — Falco"),
    )
    # pos 0 = match0.a (kai), pos 2 = match1.a (rith)
    new_bd, new_rw, warn = _swap_positions(bracket_data, {}, 0, 2)
    assert new_bd[0]["a"] == "rith — Fox"
    assert new_bd[1]["a"] == "kai — Mario"
    # untouched sides stay untouched
    assert new_bd[0]["b"] == "leap — Luigi"
    assert new_bd[1]["b"] == "vyro — Falco"
    assert new_rw == {}
    assert warn is False
    # originals untouched -- the function never mutates its inputs
    assert bracket_data[0]["a"] == "kai — Mario"
    assert bracket_data[1]["a"] == "rith — Fox"


def test_swap_within_same_match_flips_ab():
    bracket_data = _bd(("kai — Mario", "leap — Luigi"))
    new_bd, new_rw, warn = _swap_positions(bracket_data, {}, 0, 1)
    assert new_bd[0]["a"] == "leap — Luigi"
    assert new_bd[0]["b"] == "kai — Mario"
    assert warn is False


def test_recorded_result_blocks_swap_and_mutates_nothing():
    bracket_data = _bd(
        ("kai — Mario", "leap — Luigi"),
        ("rith — Fox", "vyro — Falco"),
    )
    round_winners = {"r0_m0": "kai — Mario"}  # match 0 already played
    with pytest.raises(ValueError):
        _swap_positions(bracket_data, round_winners, 0, 2)
    # nothing mutated -- inputs are exactly as passed in
    assert bracket_data[0]["a"] == "kai — Mario"
    assert round_winners == {"r0_m0": "kai — Mario"}


def test_recorded_result_on_either_side_blocks_swap():
    bracket_data = _bd(
        ("kai — Mario", "leap — Luigi"),
        ("rith — Fox", "vyro — Falco"),
    )
    round_winners = {"r0_m1": "vyro — Falco"}  # match 1 already played
    with pytest.raises(ValueError):
        _swap_positions(bracket_data, round_winners, 0, 2)


def test_bye_walkover_is_not_a_recorded_result_and_stays_swappable():
    bracket_data = _bd(
        ("kai — Mario", "BYE"),
        ("rith — Fox", "vyro — Falco"),
    )
    round_winners = {"r0_m0": "kai — Mario"}  # auto-resolved bye walkover
    # Should NOT raise -- a bye's round_winners entry doesn't count as "recorded".
    new_bd, new_rw, warn = _swap_positions(bracket_data, round_winners, 0, 2)
    assert new_bd[0]["a"] == "rith — Fox"
    assert new_bd[1]["a"] == "kai — Mario"


def test_swap_moves_real_entry_into_bye_slot_unresolves_that_match():
    bracket_data = _bd(
        ("kai — Mario", "BYE"),          # match 0: bye, auto-resolved
        ("rith — Fox", "vyro — Falco"),  # match 1: real vs real, unplayed
    )
    round_winners = {"r0_m0": "kai — Mario"}
    # pos 1 = match0.b (the BYE slot), pos 2 = match1.a (rith)
    new_bd, new_rw, warn = _swap_positions(bracket_data, round_winners, 1, 2)
    assert new_bd[0] == {"a": "kai — Mario", "b": "rith — Fox"}
    assert new_bd[1] == {"a": "BYE", "b": "vyro — Falco"}
    # match 0 now has two real entries -- must be un-resolved (played for real)
    assert "r0_m0" not in new_rw
    # match 1 now has a bye -- must be auto-resolved as a walkover
    assert new_rw["r0_m1"] == "vyro — Falco"


def test_swap_moves_bye_into_real_match_creates_new_walkover():
    # Symmetric to the above, swapping the other direction.
    bracket_data = _bd(
        ("kai — Mario", "BYE"),
        ("rith — Fox", "vyro — Falco"),
    )
    round_winners = {"r0_m0": "kai — Mario"}
    new_bd, new_rw, warn = _swap_positions(bracket_data, round_winners, 2, 1)
    assert new_bd[0] == {"a": "kai — Mario", "b": "rith — Fox"}
    assert new_bd[1] == {"a": "BYE", "b": "vyro — Falco"}
    assert "r0_m0" not in new_rw
    assert new_rw["r0_m1"] == "vyro — Falco"


def test_swap_creating_same_player_pair_succeeds_with_warning():
    bracket_data = _bd(
        ("kai — Mario", "leap — Luigi"),
        ("kai — Fox", "vyro — Falco"),
    )
    # pos 1 = match0.b (leap), pos 2 = match1.a (kai — Fox) -> swapping them
    # puts kai on both sides of match 0.
    new_bd, new_rw, warn = _swap_positions(bracket_data, {}, 1, 2)
    assert new_bd[0] == {"a": "kai — Mario", "b": "kai — Fox"}
    assert new_bd[1] == {"a": "leap — Luigi", "b": "vyro — Falco"}
    assert warn is True


def test_swap_not_creating_same_player_pair_has_no_warning():
    bracket_data = _bd(
        ("kai — Mario", "leap — Luigi"),
        ("rith — Fox", "vyro — Falco"),
    )
    new_bd, new_rw, warn = _swap_positions(bracket_data, {}, 0, 2)
    assert warn is False


def test_position_out_of_range_raises():
    bracket_data = _bd(("kai — Mario", "leap — Luigi"))
    with pytest.raises(ValueError):
        _swap_positions(bracket_data, {}, 0, 5)


def test_same_position_raises():
    bracket_data = _bd(("kai — Mario", "leap — Luigi"))
    with pytest.raises(ValueError):
        _swap_positions(bracket_data, {}, 0, 0)
