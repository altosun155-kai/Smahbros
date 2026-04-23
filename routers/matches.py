from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import User, CharacterStats, MatchResult, Bracket, CharacterMatchup
from auth import get_db, get_current_user

router = APIRouter(tags=["matches"])

K_FACTOR = 32
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


def _mov_multiplier(winner_kills: int, loser_kills: int) -> float:
    """Margin of victory multiplier based on stock difference."""
    if winner_kills == 0 and loser_kills == 0:
        return 1.0  # no score recorded — neutral
    diff = winner_kills - loser_kills
    if diff >= 3:
        return 2.0   # 3-0, dominant
    elif diff == 2:
        return 1.5  # 3-1, comfortable
    else:
        return 1.0   # 3-2, close but a win is a win


def _elo_change(winner_elo: int, loser_elo: int, winner_kills: int, loser_kills: int, k: int = K_FACTOR) -> int:
    expected = 1 / (1 + 10 ** ((loser_elo - winner_elo) / 400))
    mov = _mov_multiplier(winner_kills, loser_kills)
    change = round(k * (1 - expected) * mov)
    return max(1, change)  # always at least 1 point exchanged


def _get_or_create_stat(db: Session, user_id: int, character: str) -> CharacterStats:
    row = db.query(CharacterStats).filter_by(user_id=user_id, character=character).first()
    if row is None:
        row = CharacterStats(user_id=user_id, character=character, points=0, elo=ELO_DEFAULT, kills=0, deaths=0, wins=0, losses=0)
        db.add(row)
        db.flush()
    return row


@router.get("/matches/history")
def char_elo_history(
    username: str,
    character: str,
    limit: int = 5,
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
    limit: int = 10,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Recent clean-sweep (3-stock) events for the Wall of Shame."""
    rows = (
        db.query(MatchResult)
        .filter(MatchResult.winner_kills >= 3, MatchResult.loser_kills == 0)
        .order_by(MatchResult.created_at.desc())
        .limit(limit)
        .all()
    )
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
    # Allow kai always; allow the host of the specific bracket being played
    if current_user.username != "kai":
        if not req.bracket_id:
            raise HTTPException(status_code=403, detail="Only kai can record non-bracket match results")
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

    # Elo exchange — K is always fixed at 32 for individual matches
    delta = _elo_change(ws.elo or ELO_DEFAULT, ls.elo or ELO_DEFAULT, req.winner_kills, req.loser_kills)
    ws.elo = (ws.elo or ELO_DEFAULT) + delta
    ls.elo = max(100, (ls.elo or ELO_DEFAULT) - delta)  # floor at 100

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
