"""Integration tests for POST /brackets/{id}/swap that need a real DB + HTTP
layer: the host-only guard (needs real auth/ownership) and the full-tournament
Elo-regression check (needs the real /matches/record + /brackets/{id}/winner
flow). Pure swap-logic behavior is covered by test_bracket_swap.py instead --
no DB needed there."""

from fastapi.testclient import TestClient

from api import app
from auth import make_token
from database import SessionLocal, User, Bracket, CharacterStats, MatchResult


def _make_user(db, username):
    u = User(username=username, hashed_password="x", elo=1000)
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _play_match(client, token, tournament_id, key, winner_username, winner_char, loser_username, loser_char, score="3-0"):
    r = client.patch(f"/brackets/{tournament_id}/winner", json={
        "key": key, "winner": f"{winner_username} — {winner_char}", "score": score,
    }, headers=_auth(token))
    assert r.status_code == 200, r.text
    r = client.post("/matches/record", json={
        "winner_username": winner_username, "winner_char": winner_char, "winner_kills": 3,
        "loser_username": loser_username, "loser_char": loser_char, "loser_kills": 0,
        "bracket_id": tournament_id, "match_key": key,
    }, headers=_auth(token))
    assert r.status_code == 200, r.text


def test_non_host_swap_returns_403():
    with TestClient(app) as client:
        db = SessionLocal()
        host = _make_user(db, "swap403_host")
        other = _make_user(db, "swap403_other")
        b = Bracket(
            user_id=host.id, name="T", mode="regular",
            players=[host.username, other.username],
            bracket_data=[{"a": f"{host.username} — Mario", "b": f"{other.username} — Luigi"}],
            round_winners={}, is_live=True,
        )
        db.add(b)
        db.commit()
        db.refresh(b)

        r = client.post(f"/brackets/{b.id}/swap", json={"pos_a": 0, "pos_b": 1},
                         headers=_auth(make_token(other.id)))
        assert r.status_code == 403
        db.close()


def test_host_swap_on_non_live_bracket_returns_400():
    with TestClient(app) as client:
        db = SessionLocal()
        host = _make_user(db, "swap400_host")
        b = Bracket(
            user_id=host.id, name="T", mode="regular", players=[host.username],
            bracket_data=[{"a": f"{host.username} — Mario", "b": "BYE"}],
            round_winners={"r0_m0": f"{host.username} — Mario"}, is_live=False,
        )
        db.add(b)
        db.commit()
        db.refresh(b)

        r = client.post(f"/brackets/{b.id}/swap", json={"pos_a": 0, "pos_b": 1},
                         headers=_auth(make_token(host.id)))
        assert r.status_code == 400
        db.close()


def test_swap_then_play_matches_ratings_of_bracket_generated_that_way(tmp_path):
    """The real Elo-regression guard: play the SAME match sequence two ways --
    (1) a bracket seeded correctly from the start, (2) a bracket seeded wrong
    then fixed with a pre-match swap -- and confirm every player's and every
    character's final Elo matches exactly. This is what "swapping only
    unplayed matches means zero Elo work" is supposed to guarantee; if the
    swap ever touched Elo, or the bye/round_winners recomputation ever left
    a stray entry, these numbers would drift apart.
    """
    with TestClient(app) as client:
        # ── Scenario 1: baseline, seeded correctly (A vs B, C vs D) from the start ──
        db = SessionLocal()
        a1 = _make_user(db, "elo1_a")
        b1 = _make_user(db, "elo1_b")
        c1 = _make_user(db, "elo1_c")
        d1 = _make_user(db, "elo1_d")
        host1 = a1
        bracket1 = Bracket(
            user_id=host1.id, name="Baseline", mode="regular",
            players=[a1.username, b1.username, c1.username, d1.username],
            bracket_data=[
                {"a": f"{a1.username} — Mario", "b": f"{b1.username} — Luigi"},
                {"a": f"{c1.username} — Fox",   "b": f"{d1.username} — Falco"},
            ],
            round_winners={}, is_live=True,
        )
        db.add(bracket1)
        db.commit()
        db.refresh(bracket1)
        tok1 = make_token(host1.id)

        _play_match(client, tok1, bracket1.id, "r0_m0", a1.username, "Mario", b1.username, "Luigi")
        _play_match(client, tok1, bracket1.id, "r0_m1", c1.username, "Fox", d1.username, "Falco")
        _play_match(client, tok1, bracket1.id, "r1_m0", a1.username, "Mario", c1.username, "Fox")

        db.refresh(a1); db.refresh(b1); db.refresh(c1); db.refresh(d1)
        baseline_elo = {
            "a": a1.elo, "b": b1.elo, "c": c1.elo, "d": d1.elo,
        }

        # Elo's K-factor depends on rank among every user/character currently
        # in the DB (see routers/matches.py::record_match) -- if scenario 1's
        # now-diverged Elo values were still present in the ranking pool while
        # scenario 2 plays out, its K-factors (and therefore its final Elo)
        # would differ from scenario 1's for a reason that has nothing to do
        # with the swap. Delete scenario 1's rows so scenario 2 starts from
        # the same rank-neutral state scenario 1 did.
        for uid in (a1.id, b1.id, c1.id, d1.id):
            db.query(CharacterStats).filter(CharacterStats.user_id == uid).delete()
            db.query(MatchResult).filter((MatchResult.winner_id == uid) | (MatchResult.loser_id == uid)).delete()
        db.query(Bracket).filter(Bracket.id == bracket1.id).delete()
        for u in (a1, b1, c1, d1):
            db.delete(u)
        db.commit()
        db.close()

        # ── Scenario 2: seeded WRONG (A vs C, B vs D), then swapped to match
        #    scenario 1's actual pairing (A vs B, C vs D) before anything is
        #    played, then the exact same match sequence is played out. ──
        db = SessionLocal()
        a2 = _make_user(db, "elo2_a")
        b2 = _make_user(db, "elo2_b")
        c2 = _make_user(db, "elo2_c")
        d2 = _make_user(db, "elo2_d")
        host2 = a2
        bracket2 = Bracket(
            user_id=host2.id, name="Swapped", mode="regular",
            players=[a2.username, b2.username, c2.username, d2.username],
            bracket_data=[
                {"a": f"{a2.username} — Mario", "b": f"{c2.username} — Fox"},
                {"a": f"{b2.username} — Luigi", "b": f"{d2.username} — Falco"},
            ],
            round_winners={}, is_live=True,
        )
        db.add(bracket2)
        db.commit()
        db.refresh(bracket2)
        tok2 = make_token(host2.id)

        # pos 1 = match0.b (c2 — Fox), pos 2 = match1.a (b2 — Luigi) -- swap
        # them so match 0 becomes A vs B and match 1 becomes C vs D.
        r = client.post(f"/brackets/{bracket2.id}/swap", json={"pos_a": 1, "pos_b": 2}, headers=_auth(tok2))
        assert r.status_code == 200, r.text
        assert r.json()["same_player_warning"] is False

        r = client.get(f"/brackets/{bracket2.id}", headers=_auth(tok2))
        bd = r.json()["bracket_data"]
        assert bd[0] == {"a": f"{a2.username} — Mario", "b": f"{b2.username} — Luigi"}
        assert bd[1] == {"a": f"{c2.username} — Fox", "b": f"{d2.username} — Falco"}

        _play_match(client, tok2, bracket2.id, "r0_m0", a2.username, "Mario", b2.username, "Luigi")
        _play_match(client, tok2, bracket2.id, "r0_m1", c2.username, "Fox", d2.username, "Falco")
        _play_match(client, tok2, bracket2.id, "r1_m0", a2.username, "Mario", c2.username, "Fox")

        db.refresh(a2); db.refresh(b2); db.refresh(c2); db.refresh(d2)
        swapped_elo = {
            "a": a2.elo, "b": b2.elo, "c": c2.elo, "d": d2.elo,
        }
        db.close()

        assert swapped_elo == baseline_elo, (
            f"post-swap ratings diverged from the equivalent from-scratch bracket: "
            f"baseline={baseline_elo} swapped={swapped_elo}"
        )
