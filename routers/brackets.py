import re as _re
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from database import User, Bracket, TournamentInvite, CharacterStats, MatchResult
from auth import get_db, get_current_user


def _parse_label(val: str):
    """Return (player, character) from 'player — character' label, or (None, None)."""
    if val and " — " in val:
        parts = val.split(" — ", 1)
        return parts[0].strip(), parts[1].strip()
    return None, None


def _compute_round_participants(bracket_data: list, round_winners: dict) -> dict:
    """Return {ri: {mi: (a_label, b_label)}} reconstructing all rounds from bracket_data."""
    if not bracket_data:
        return {}
    result = {0: {mi: (p.get("a", ""), p.get("b", "")) for mi, p in enumerate(bracket_data)}}
    ri = 0
    while len(result[ri]) > 1:
        prev = result[ri]
        next_round = {}
        sorted_mis = sorted(prev.keys())
        for j in range(0, len(sorted_mis), 2):
            if j + 1 >= len(sorted_mis):
                break
            ma, mb = sorted_mis[j], sorted_mis[j + 1]
            next_round[j // 2] = (
                round_winners.get(f"r{ri}_m{ma}", ""),
                round_winners.get(f"r{ri}_m{mb}", ""),
            )
        result[ri + 1] = next_round
        ri += 1
    return result

def _swap_positions(bracket_data: list, round_winners: dict, pos_a: int, pos_b: int):
    """Exchange two round-1 seed positions and return (new_bracket_data,
    new_round_winners, same_player_warning). Pure and side-effect-free -- never
    mutates its inputs, always returns fresh copies -- so a caller that raises
    partway through has left nothing half-changed, and this is unit-testable
    without a DB or request context (matches draft.py's _deal_bracket/
    _build_free_pool_bracket split).

    Position N is bracket_data[N // 2]['a' if N % 2 == 0 else 'b'] -- seed
    positions, not labels, since two entries can now share a label (same
    player, different character) once the same person can appear twice in a
    draft-mode free pool.

    A match counts as having "a recorded winner" (and is therefore frozen)
    only if round_winners has an entry for it AND neither side is a bye --
    bye walkovers are auto-resolved at creation time (see
    draft.py::_build_free_pool_bracket) and never touch Elo, so they're the
    one kind of "already decided" match that's still safe to rearrange.
    """
    n_positions = len(bracket_data) * 2
    if not (0 <= pos_a < n_positions) or not (0 <= pos_b < n_positions):
        raise ValueError("Position out of range for round 1")
    if pos_a == pos_b:
        raise ValueError("Positions must differ")

    def slot_of(pos):
        return pos // 2, ("a" if pos % 2 == 0 else "b")

    mi_a, slot_a = slot_of(pos_a)
    mi_b, slot_b = slot_of(pos_b)

    def has_recorded_result(mi):
        pair = bracket_data[mi]
        winner = round_winners.get(f"r0_m{mi}")
        is_bye_match = pair.get("a") == "BYE" or pair.get("b") == "BYE"
        return bool(winner) and not is_bye_match

    if has_recorded_result(mi_a) or has_recorded_result(mi_b):
        raise ValueError("Cannot swap a match that already has a recorded result")

    new_bracket_data = [dict(p) for p in bracket_data]
    new_bracket_data[mi_a][slot_a], new_bracket_data[mi_b][slot_b] = (
        new_bracket_data[mi_b][slot_b],
        new_bracket_data[mi_a][slot_a],
    )

    # Bye recomputation -- if either affected match now has exactly one BYE
    # side, auto-resolve it (mirrors _build_free_pool_bracket exactly); if it
    # no longer has a bye side, un-resolve it so it becomes a real match to
    # be played. Forgetting this leaves a match that silently never resolves,
    # or a walkover result that isn't actually a walkover.
    new_round_winners = dict(round_winners)
    for mi in {mi_a, mi_b}:
        pair = new_bracket_data[mi]
        key = f"r0_m{mi}"
        a_is_bye = pair.get("a") == "BYE"
        b_is_bye = pair.get("b") == "BYE"
        if a_is_bye and b_is_bye:
            new_round_winners.pop(key, None)  # unreachable today, stay inert if it ever happens
        elif a_is_bye:
            new_round_winners[key] = pair.get("b")
        elif b_is_bye:
            new_round_winners[key] = pair.get("a")
        else:
            new_round_winners.pop(key, None)

    # Same-player warning -- surfaced, not blocked. The host is fixing
    # something on purpose; this is the one invariant the seeding algorithm
    # exists to protect, so it's worth a flag, not a rejection.
    same_player_warning = False
    for mi in {mi_a, mi_b}:
        pair = new_bracket_data[mi]
        pa, _ = _parse_label(pair.get("a"))
        pb, _ = _parse_label(pair.get("b"))
        if pa and pb and pa == pb:
            same_player_warning = True

    return new_bracket_data, new_round_winners, same_player_warning


router = APIRouter(tags=["brackets"])


class BracketCreate(BaseModel):
    name: str
    mode: str = "regular"
    players: list = []
    entries: list = []
    bracket_data: list = []
    bracket_style: str = "strongVsStrong"
    is_live: bool = False
    invite_usernames: list = []
    chars_per_player: int = 2


class WinnerUpdate(BaseModel):
    key: str
    winner: str
    score: str | None = None
    tournament_winner: str | None = None  # set when this is the Grand Final match


class EntryCharUpdate(BaseModel):
    old_char: str
    new_char: str


class SwapRequest(BaseModel):
    pos_a: int
    pos_b: int


class LineupConfirm(BaseModel):
    characters: list[str]


class GenerateBracketData(BaseModel):
    bracket_data: list
    entries: list = []


def _infer_winner(b: Bracket) -> str | None:
    """Derive the tournament champion from round_winners if b.winner is unset."""
    if b.winner:
        return b.winner
    rw = b.round_winners or {}
    if not rw:
        return None
    import re as _re
    best_ri, gf_val = -1, None
    for k, v in rw.items():
        m = _re.match(r"r(\d+)_m(\d+)$", k)
        if m:
            ri = int(m.group(1))
            if ri > best_ri:
                best_ri, gf_val = ri, v
    if gf_val and " — " in gf_val:
        return gf_val.split(" — ")[0]
    return None


def bracket_to_dict(b: Bracket, include_invites: bool = False, viewer: User | None = None, db: Session | None = None):
    d = {
        "id": b.id,
        "name": b.name,
        "mode": b.mode,
        "players": b.players,
        "entries": b.entries,
        "bracket_data": b.bracket_data,
        "round_winners": b.round_winners or {},
        "round_scores":  b.round_scores  or {},
        "bracket_style": b.bracket_style or "strongVsStrong",
        "is_live": b.is_live,
        "winner": _infer_winner(b),
        "host": b.owner.username,
        "host_avatar": b.owner.avatar_url,
        "chars_per_player": b.chars_per_player or 2,
        "confirmed_lineups": b.confirmed_lineups or {},
        "placements": b.placements or {},
        "created_at": b.created_at.isoformat(),
    }
    if include_invites:
        d["invites"] = [
            {"id": i.id, "invitee": i.invitee.username, "status": i.status}
            for i in b.invites
        ]
    if viewer is not None and db is not None:
        from routers.matches import _bracket_is_draft_accessible
        is_owner = b.user_id == viewer.id
        d["can_record"] = bool(viewer.is_admin or is_owner or _bracket_is_draft_accessible(db, b.id, viewer))
    return d


@router.get("/brackets")
def list_brackets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    brackets = (
        db.query(Bracket)
        .filter(Bracket.user_id == current_user.id)
        .order_by(Bracket.created_at.desc())
        .all()
    )
    return [{"id": b.id, "name": b.name, "mode": b.mode, "is_live": b.is_live, "winner": b.winner, "placements": b.placements, "created_at": b.created_at.isoformat()} for b in brackets]


@router.post("/brackets")
def create_bracket(req: BracketCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bracket = Bracket(
        user_id=current_user.id,
        name=req.name,
        mode=req.mode,
        players=req.players,
        entries=req.entries,
        bracket_data=req.bracket_data,
        round_winners={},
        bracket_style=req.bracket_style,
        is_live=req.is_live,
        chars_per_player=req.chars_per_player,
        confirmed_lineups={},
    )
    db.add(bracket)
    db.commit()
    db.refresh(bracket)

    for username in req.invite_usernames:
        invitee = db.query(User).filter(User.username == username).first()
        if invitee and invitee.id != current_user.id:
            invite = TournamentInvite(bracket_id=bracket.id, inviter_id=current_user.id, invitee_id=invitee.id)
            db.add(invite)
    db.commit()

    return {"id": bracket.id, "name": bracket.name}


@router.get("/brackets/live")
def list_live_brackets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    invites = (
        db.query(TournamentInvite)
        .filter(TournamentInvite.invitee_id == current_user.id, TournamentInvite.status == "accepted")
        .all()
    )
    result = []
    for inv in invites:
        b = inv.bracket
        if b and b.is_live:
            result.append({"id": b.id, "name": b.name, "host": b.owner.username, "created_at": b.created_at.isoformat()})
    return result


@router.get("/brackets/{bracket_id}")
def get_bracket(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Bracket not found")
    is_owner = b.user_id == current_user.id
    invite = db.query(TournamentInvite).filter(
        TournamentInvite.bracket_id == bracket_id,
        TournamentInvite.invitee_id == current_user.id,
    ).first()
    if not is_owner and not invite:
        if not b.is_live:
            raise HTTPException(status_code=403, detail="Not authorized")
        # Live tournament: any authenticated user can join via link — create invite row for tracking
        invite = TournamentInvite(bracket_id=bracket_id, inviter_id=b.user_id, invitee_id=current_user.id, status="accepted")
        db.add(invite)
        db.commit()
    elif invite and invite.status == "pending":
        invite.status = "accepted"
        db.commit()
    return bracket_to_dict(b, include_invites=is_owner, viewer=current_user, db=db)


@router.patch("/brackets/{bracket_id}/winner")
def set_bracket_winner(bracket_id: int, req: WinnerUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id).first()
    from routers.matches import _bracket_is_draft_accessible
    is_owner = b and b.user_id == current_user.id
    if not b or not (is_owner or _bracket_is_draft_accessible(db, bracket_id, current_user)):
        raise HTTPException(status_code=403, detail="Only the host can record results")
    rw = dict(b.round_winners or {})
    rw[req.key] = req.winner
    b.round_winners = rw
    flag_modified(b, "round_winners")
    if req.score:
        rs = dict(b.round_scores or {})
        rs[req.key] = req.score
        b.round_scores = rs
        flag_modified(b, "round_scores")
    if req.tournament_winner:
        b.winner = req.tournament_winner
    db.commit()
    return {"ok": True}


@router.patch("/brackets/{bracket_id}/my-character")
def update_my_character(bracket_id: int, req: EntryCharUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.is_live == True).first()
    if not b:
        raise HTTPException(status_code=404, detail="Live bracket not found")
    if b.mode == "draft":
        raise HTTPException(status_code=400, detail="Draft characters are won through picks, not editable after the fact")

    old_label = f"{current_user.username} — {req.old_char}"
    new_label = f"{current_user.username} — {req.new_char}"

    entries = list(b.entries or [])
    for e in entries:
        if e.get("player") == current_user.username and e.get("character") == req.old_char:
            e["character"] = req.new_char
    b.entries = entries
    flag_modified(b, "entries")

    bracket_data = list(b.bracket_data or [])
    for pair in bracket_data:
        if pair.get("a") == old_label:
            pair["a"] = new_label
        if pair.get("b") == old_label:
            pair["b"] = new_label
    b.bracket_data = bracket_data
    flag_modified(b, "bracket_data")

    db.commit()
    return {"ok": True, "new_label": new_label}


@router.post("/brackets/{bracket_id}/swap")
def swap_matchup(bracket_id: int, req: SwapRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Host-only: exchange two round-1 seed positions in a live bracket. Only
    ever touches unplayed matches (see _swap_positions) -- Elo is
    path-dependent (match 2's delta was computed against ratings that already
    included match 1's delta), so there is no way to "undo" a played match's
    contribution without ratings deriving from the match log on load rather
    than being mutated in place. Byes are the one exception: they're
    auto-resolved walkovers that never touch Elo, so swapping in or out of a
    bye slot is always safe and handled by the bye-recomputation below.
    """
    b = db.query(Bracket).filter(Bracket.id == bracket_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Bracket not found")
    if b.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the host can swap matchups")
    if not b.is_live:
        raise HTTPException(status_code=400, detail="Bracket is not live")

    try:
        new_bracket_data, new_round_winners, same_player_warning = _swap_positions(
            list(b.bracket_data or []), dict(b.round_winners or {}), req.pos_a, req.pos_b
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    b.bracket_data = new_bracket_data
    flag_modified(b, "bracket_data")
    b.round_winners = new_round_winners
    flag_modified(b, "round_winners")
    db.commit()

    import ws_manager
    ws_manager.push(bracket_id, bracket_to_dict(b, viewer=current_user, db=db))

    return {"ok": True, "same_player_warning": same_player_warning}


@router.patch("/brackets/{bracket_id}/confirm-lineup")
def confirm_lineup(bracket_id: int, req: LineupConfirm, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.is_live == True).first()
    if not b:
        raise HTTPException(status_code=404, detail="Live bracket not found")
    if current_user.username not in (b.players or []) and b.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not in this tournament")
    lineups = dict(b.confirmed_lineups or {})
    lineups[current_user.username] = [c for c in req.characters if c]
    b.confirmed_lineups = lineups
    flag_modified(b, "confirmed_lineups")
    db.commit()
    return {"ok": True}


@router.post("/brackets/{bracket_id}/generate-from-lineups")
def generate_from_lineups(bracket_id: int, req: GenerateBracketData, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id, Bracket.is_live == True).first()
    if not b:
        raise HTTPException(status_code=403, detail="Only the host can generate the bracket")
    b.bracket_data = req.bracket_data
    b.entries = req.entries
    flag_modified(b, "bracket_data")
    flag_modified(b, "entries")
    db.commit()
    return {"ok": True}


@router.patch("/brackets/{bracket_id}/end")
def end_tournament(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id).first()
    if not b:
        raise HTTPException(status_code=403, detail="Only the host can end")

    already_ended = not b.is_live
    b.is_live = False

    # b.winner is only set via set_bracket_winner (tournament_winner field)
    # when the actual Grand Final match is recorded. If it's null here, the
    # tournament is being ended early — do not assign a winner or give bonuses.
    gf_completed = bool(b.winner)

    # Award placement bonuses only if the Grand Final was completed and
    # this is the first time ending (not already_ended).
    bonuses = []
    if not already_ended and gf_completed and b.round_winners and b.bracket_data:
        from routers.matches import _get_or_create_stat, ELO_DEFAULT, K_FACTOR
        num_players = len(b.players or [])
        k = num_players * 4  # 4p=16, 8p=32, 16p=64

        rw = b.round_winners

        # Compute the expected Grand Final round index from bracket size.
        # bracket_data is always padded to a power of 2, so GF is at
        # r<log2(len)>_m0. Walk the bit to avoid importing math.
        r1_count = len(b.bracket_data)
        expected_gf_ri = 0
        n = r1_count
        while n > 1:
            n >>= 1
            expected_gf_ri += 1

        # Only award bonuses if the Grand Final was actually played.
        # Using the expected round index (from bracket size) prevents early-end
        # scenarios from misidentifying a semifinal winner as champion.
        gf_winner_label = rw.get(f"r{expected_gf_ri}_m0", "")
        max_ri = expected_gf_ri

        if gf_winner_label and " — " in gf_winner_label:
            participants = _compute_round_participants(b.bracket_data, rw)

            # 1st place: Grand Final winner
            gf_winner_player, gf_winner_char = _parse_label(gf_winner_label)
            if gf_winner_player:
                bonuses.append((gf_winner_player, gf_winner_char, round(k * 1.0), "1st"))

            # 2nd place: Grand Final loser
            gf_a_label, gf_b_label = participants.get(max_ri, {}).get(0, ("", ""))
            gf_a_player, gf_a_char = _parse_label(gf_a_label)
            gf_b_player, gf_b_char = _parse_label(gf_b_label)
            if gf_winner_player:
                if gf_a_player and gf_a_player != gf_winner_player:
                    bonuses.append((gf_a_player, gf_a_char, round(k * 0.5), "2nd"))
                elif gf_b_player and gf_b_player != gf_winner_player:
                    bonuses.append((gf_b_player, gf_b_char, round(k * 0.5), "2nd"))

            # 3rd place: Semifinal losers (only if there was a semifinal round)
            if max_ri > 0:
                sf_matches = participants.get(max_ri - 1, {})
                for sf_mi, (sf_a_label, sf_b_label) in sf_matches.items():
                    sf_winner_label = rw.get(f"r{max_ri-1}_m{sf_mi}", "")
                    sf_winner_player, _ = _parse_label(sf_winner_label)
                    sf_a_player, sf_a_char = _parse_label(sf_a_label)
                    sf_b_player, sf_b_char = _parse_label(sf_b_label)
                    if sf_winner_player:
                        if sf_a_player and sf_a_player != sf_winner_player:
                            bonuses.append((sf_a_player, sf_a_char, round(k * 0.25), "3rd"))
                        elif sf_b_player and sf_b_player != sf_winner_player:
                            bonuses.append((sf_b_player, sf_b_char, round(k * 0.25), "3rd"))

            # Save placements to the bracket record (player + character)
            placement_map = {"1st": None, "2nd": None, "3rd": []}
            for (player, char, bonus, place) in bonuses:
                entry = {"player": player, "char": char, "elo_bonus": bonus}
                if place == "1st":
                    placement_map["1st"] = entry
                elif place == "2nd":
                    placement_map["2nd"] = entry
                elif place == "3rd":
                    placement_map["3rd"].append(entry)
            b.placements = placement_map
            flag_modified(b, "placements")

            # Apply bonuses to character Elo
            for (player, char, bonus, _) in bonuses:
                if not player or not char:
                    continue
                user = db.query(User).filter(User.username == player).first()
                if not user:
                    continue
                stat = _get_or_create_stat(db, user.id, char)
                stat.elo = (stat.elo or ELO_DEFAULT) + bonus

    # Always mark placements so list_brackets can distinguish ended-early from drafts
    if b.placements is None:
        b.placements = {}
        flag_modified(b, "placements")

    db.commit()
    return {
        "ok": True,
        "bonuses": [{"player": p, "char": c, "bonus": b, "place": pl} for p, c, b, pl in bonuses],
    }


@router.delete("/brackets/{bracket_id}")
def delete_bracket(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bracket = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id).first()
    if not bracket:
        raise HTTPException(status_code=404, detail="Bracket not found")
    db.delete(bracket)
    db.commit()
    return {"ok": True}


@router.delete("/brackets/{bracket_id}/result/{match_key:path}")
def undo_result_by_key(bracket_id: int, match_key: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id).first()
    from routers.matches import _bracket_is_draft_accessible
    is_owner = b and b.user_id == current_user.id
    if not b or not (is_owner or _bracket_is_draft_accessible(db, bracket_id, current_user)):
        raise HTTPException(status_code=403, detail="Only the host can undo")
    mr = db.query(MatchResult).filter(
        MatchResult.bracket_id == bracket_id,
        MatchResult.match_key == match_key,
    ).order_by(MatchResult.created_at.desc()).first()
    if not mr:
        return {"ok": True, "skipped": "no result for this match key"}

    ws = db.query(CharacterStats).filter(
        CharacterStats.user_id == mr.winner_id, CharacterStats.character == mr.winner_char
    ).first()
    ls = db.query(CharacterStats).filter(
        CharacterStats.user_id == mr.loser_id, CharacterStats.character == mr.loser_char
    ).first()
    from routers.matches import ELO_DEFAULT
    delta = mr.elo_delta or 0
    if ws:
        ws.elo    = max(100, (ws.elo or ELO_DEFAULT) - delta)
        ws.points = max(0, (ws.points or 0) - 1)
        ws.wins   = max(0, (ws.wins   or 0) - 1)
        ws.kills  = max(0, (ws.kills  or 0) - (mr.winner_kills or 0))
        ws.deaths = max(0, (ws.deaths or 0) - (mr.loser_kills  or 0))
    if ls:
        ls.elo    = (ls.elo or ELO_DEFAULT) + delta
        ls.losses = max(0, (ls.losses or 0) - 1)
        ls.kills  = max(0, (ls.kills  or 0) - (mr.loser_kills  or 0))
        ls.deaths = max(0, (ls.deaths or 0) - (mr.winner_kills or 0))

    rw = dict(b.round_winners or {})
    rw.pop(match_key, None)
    b.round_winners = rw
    flag_modified(b, "round_winners")
    rs = dict(b.round_scores or {})
    rs.pop(match_key, None)
    b.round_scores = rs
    flag_modified(b, "round_scores")

    undone_label = f"{mr.winner.username} ({mr.winner_char})"
    db.delete(mr)
    db.commit()
    return {"ok": True, "undone": undone_label}


@router.delete("/brackets/{bracket_id}/last-result")
def undo_last_result(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    b = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id).first()
    if not b:
        raise HTTPException(status_code=403, detail="Only the host can undo")
    mr = db.query(MatchResult).filter(MatchResult.bracket_id == bracket_id)\
        .order_by(MatchResult.created_at.desc()).first()
    if not mr:
        raise HTTPException(status_code=404, detail="No recorded results to undo")

    ws = db.query(CharacterStats).filter(
        CharacterStats.user_id == mr.winner_id, CharacterStats.character == mr.winner_char
    ).first()
    ls = db.query(CharacterStats).filter(
        CharacterStats.user_id == mr.loser_id, CharacterStats.character == mr.loser_char
    ).first()
    from routers.matches import ELO_DEFAULT
    delta = mr.elo_delta or 0
    if ws:
        ws.elo    = max(100, (ws.elo or ELO_DEFAULT) - delta)
        ws.points = max(0, (ws.points or 0) - 1)
        ws.wins   = max(0, (ws.wins   or 0) - 1)
        ws.kills  = max(0, (ws.kills  or 0) - (mr.winner_kills or 0))
        ws.deaths = max(0, (ws.deaths or 0) - (mr.loser_kills  or 0))
    if ls:
        ls.elo    = (ls.elo or ELO_DEFAULT) + delta
        ls.losses = max(0, (ls.losses or 0) - 1)
        ls.kills  = max(0, (ls.kills  or 0) - (mr.loser_kills  or 0))
        ls.deaths = max(0, (ls.deaths or 0) - (mr.winner_kills or 0))

    if mr.match_key:
        rw = dict(b.round_winners or {})
        rw.pop(mr.match_key, None)
        b.round_winners = rw
        flag_modified(b, "round_winners")
        rs = dict(b.round_scores or {})
        rs.pop(mr.match_key, None)
        b.round_scores = rs
        flag_modified(b, "round_scores")

    winner_name = mr.winner.username
    winner_char = mr.winner_char
    db.delete(mr)
    db.commit()
    return {"ok": True, "undone": f"{winner_name} ({winner_char})"}
