from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

from database import User, CharacterStats, MatchResult, Bracket, CharacterMatchup
from auth import get_db, get_current_user

router = APIRouter(tags=["matches"])

ELO_DEFAULT = 1000


class MatchRecord(BaseModel):
    winner_username: str
    winner_char: str
    winner_kills: int = 0
    loser_username: str
    loser_char: str
    loser_kills: int = 0
    bracket_id: int | None = None
    match_key: str | None = None


def _k_factor(rank: int) -> int:
    """Dynamic K based on leaderboard position: top 10 are stable, lower ranks move faster."""
    if rank <= 10:
        return 10
    if rank <= 25:
        return 20
    return 40


def _mov_multiplier(winner_kills: int, loser_kills: int) -> float:
    """MoV scaling: 3-2→1.25x, 3-1→1.5x, 3-0→2x (clean sweep bonus)."""
    if winner_kills == 0 and loser_kills == 0:
        return 1.0
    diff = max(0, winner_kills - loser_kills)
    if diff >= 3:
        return 2.0
    return 1.0 + diff * 0.25


def _elo_change(winner_elo: int, loser_elo: int, winner_kills: int, loser_kills: int, k: int = 32) -> int:
    expected = 1 / (1 + 10 ** ((loser_elo - winner_elo) / 400))
    mov = _mov_multiplier(winner_kills, loser_kills)
    change = round(k * (1 - expected) * mov)
    return max(1, change)


def _get_or_create_stat(db: Session, user_id: int, character: str) -> CharacterStats:
    row = db.query(CharacterStats).filter_by(user_id=user_id, character=character).first()
    if row is None:
        try:
            # New character starts at player's existing avg Elo — not always 1000 (#9)
            existing = db.query(CharacterStats).filter_by(user_id=user_id).all()
            start_elo = (
                round(sum(s.elo or ELO_DEFAULT for s in existing) / len(existing))
                if existing else ELO_DEFAULT
            )
            row = CharacterStats(user_id=user_id, character=character, points=0,
                                 elo=start_elo, kills=0, deaths=0, wins=0, losses=0)
            db.add(row)
            db.flush()
        except IntegrityError:
            db.rollback()
            row = db.query(CharacterStats).filter_by(user_id=user_id, character=character).first()
    return row


@router.get("/matches/history")
def char_elo_history(
    username: str,
    character: str,
    limit: int = 20,
    db: Session = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    rows = (
        db.query(MatchResult)
        .filter(
            ((MatchResult.winner_id == user.id) & (MatchResult.winner_char == character)) |
            ((MatchResult.loser_id  == user.id) & (MatchResult.loser_char  == character))
        )
        .order_by(MatchResult.created_at.desc())
        .limit(limit)
        .all()
    )

    results = []
    for r in rows:
        won = r.winner_id == user.id
        opponent_id = r.loser_id if won else r.winner_id
        opponent_char = r.loser_char if won else r.winner_char
        opponent = db.query(User).filter(User.id == opponent_id).first()
        results.append({
            "won": won,
            "elo_delta": r.elo_delta if won else -r.elo_delta,
            "opponent": opponent.username if opponent else "?",
            "opponent_char": opponent_char,
            "my_kills": r.winner_kills if won else r.loser_kills,
            "opp_kills": r.loser_kills if won else r.winner_kills,
            "created_at": r.created_at.isoformat(),
        })
    return results


@router.get("/matches/shame")
def shame_feed(
    limit: Optional[int] = None,
    victim: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Recent clean-sweep (3-stock) events. Omit limit to fetch all."""
    q = db.query(MatchResult).filter(
        MatchResult.winner_kills >= 3, MatchResult.loser_kills == 0
    )
    if victim:
        loser_user = db.query(User).filter(User.username == victim).first()
        if loser_user:
            q = q.filter(MatchResult.loser_id == loser_user.id)
        else:
            return []
    q = q.order_by(MatchResult.created_at.desc())
    rows = (q.limit(limit) if limit else q).all()
    return [{
        "winner": r.winner.username,
        "winner_char": r.winner_char,
        "winner_avatar": r.winner.avatar_url,
        "loser": r.loser.username,
        "loser_char": r.loser_char,
        "loser_avatar": r.loser.avatar_url,
        "created_at": r.created_at.isoformat(),
    } for r in rows]


@router.post("/matches/record")
def record_match(req: MatchRecord, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Admins can record any match; non-admins can only record matches for brackets they host
    if not current_user.is_admin:
        if not req.bracket_id:
            raise HTTPException(status_code=403, detail="Only admins can record non-bracket match results")
        bracket = db.query(Bracket).filter(Bracket.id == req.bracket_id).first()
        if not bracket or bracket.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Only the bracket host can record match results")
    winner = db.query(User).filter(User.username == req.winner_username).first()
    loser  = db.query(User).filter(User.username == req.loser_username).first()
    if not winner or not loser:
        raise HTTPException(status_code=400, detail="Unknown username")
    if winner.id == loser.id:
        return {"ok": True, "skipped": "self-play"}

    ws = _get_or_create_stat(db, winner.id, req.winner_char)
    ls = _get_or_create_stat(db, loser.id,  req.loser_char)

    # Character-level Elo: K based on character leaderboard rank
    w_char_rank = db.query(CharacterStats).filter(CharacterStats.elo > (ws.elo or ELO_DEFAULT)).count() + 1
    l_char_rank = db.query(CharacterStats).filter(CharacterStats.elo > (ls.elo or ELO_DEFAULT)).count() + 1
    char_k = (_k_factor(w_char_rank) + _k_factor(l_char_rank)) // 2
    delta = _elo_change(ws.elo or ELO_DEFAULT, ls.elo or ELO_DEFAULT, req.winner_kills, req.loser_kills, k=char_k)
    ws.elo = (ws.elo or ELO_DEFAULT) + delta
    ls.elo = max(100, (ls.elo or ELO_DEFAULT) - delta)

    # Player-level Elo: K based on player leaderboard rank (#8)
    w_player_elo = winner.elo or ELO_DEFAULT
    l_player_elo = loser.elo  or ELO_DEFAULT
    w_player_rank = db.query(User).filter(User.elo > w_player_elo).count() + 1
    l_player_rank = db.query(User).filter(User.elo > l_player_elo).count() + 1
    player_k = (_k_factor(w_player_rank) + _k_factor(l_player_rank)) // 2
    player_delta = _elo_change(w_player_elo, l_player_elo, req.winner_kills, req.loser_kills, k=player_k)
    winner.elo = w_player_elo + player_delta
    loser.elo  = max(100, l_player_elo - player_delta)

    # Points (net wins, used for seeding — kept separate from Elo)
    ws.points = (ws.points or 0) + 1
    ls.points = max(0, (ls.points or 0) - 1)

    ws.wins   = (ws.wins   or 0) + 1
    ls.losses = (ls.losses or 0) + 1

    if req.winner_kills > 0:
        ws.kills  = (ws.kills  or 0) + req.winner_kills
        ls.deaths = (ls.deaths or 0) + req.winner_kills
    if req.loser_kills > 0:
        ls.kills  = (ls.kills  or 0) + req.loser_kills
        ws.deaths = (ws.deaths or 0) + req.loser_kills

    mr = MatchResult(
        winner_id=winner.id, winner_char=req.winner_char, winner_kills=req.winner_kills,
        loser_id=loser.id,   loser_char=req.loser_char,   loser_kills=req.loser_kills,
        bracket_id=req.bracket_id,
        match_key=req.match_key,
        elo_delta=delta,
    )
    db.add(mr)

    # Update global character-vs-character matchup record
    ca, cb = sorted([req.winner_char, req.loser_char])
    mu = db.query(CharacterMatchup).filter(
        CharacterMatchup.char_a == ca, CharacterMatchup.char_b == cb
    ).first()
    if not mu:
        mu = CharacterMatchup(char_a=ca, char_b=cb, wins_a=0, wins_b=0)
        db.add(mu)
        db.flush()
    if req.winner_char == ca:
        mu.wins_a = (mu.wins_a or 0) + 1
    else:
        mu.wins_b = (mu.wins_b or 0) + 1

    db.commit()
    return {"ok": True, "elo_delta": delta}


class SacrificeRecord(BaseModel):
    username: str
    character: str
    bracket_id: int | None = None


@router.post("/matches/sacrifice")
def record_sacrifice(req: SacrificeRecord, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Increment the sacrifice count for a character. No elo change."""
    if current_user.username != "kai":
        if not req.bracket_id:
            raise HTTPException(status_code=403, detail="Only the bracket host can record sacrifices")
        bracket = db.query(Bracket).filter(Bracket.id == req.bracket_id).first()
        if not bracket or bracket.user_id != current_user.id:
            raise HTTPException(status_code=403, detail="Only the bracket host can record sacrifices")
    user = db.query(User).filter(User.username == req.username).first()
    if not user:
        raise HTTPException(status_code=400, detail="Unknown username")
    stat = _get_or_create_stat(db, user.id, req.character)
    stat.sacrifices = (stat.sacrifices or 0) + 1
    db.commit()
    return {"ok": True}
