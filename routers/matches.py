from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import User, CharacterStats, MatchResult
from auth import get_db, get_current_user

router = APIRouter(tags=["matches"])


class MatchRecord(BaseModel):
    winner_username: str
    winner_char: str
    winner_kills: int = 0
    loser_username: str
    loser_char: str
    loser_kills: int = 0
    bracket_id: int | None = None
    match_key: str | None = None


def _update_char_stat(db: Session, user_id: int, character: str, result: str, kill_count: int = 0, death_count: int = 0):
    row = db.query(CharacterStats).filter_by(user_id=user_id, character=character).first()
    if row is None:
        row = CharacterStats(user_id=user_id, character=character, points=0, kills=0, deaths=0, wins=0, losses=0)
        db.add(row)
    if result == "win":
        row.points += 1
        row.wins = (row.wins or 0) + 1
    else:
        row.points = max(0, row.points - 1)
        row.losses = (row.losses or 0) + 1
    if kill_count > 0:
        row.kills = (row.kills or 0) + kill_count
    if death_count > 0:
        row.deaths = (row.deaths or 0) + death_count


@router.post("/matches/record")
def record_match(req: MatchRecord, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    winner = db.query(User).filter(User.username == req.winner_username).first()
    loser  = db.query(User).filter(User.username == req.loser_username).first()
    if not winner or not loser:
        raise HTTPException(status_code=400, detail="Unknown username")
    if winner.id == loser.id:
        return {"ok": True, "skipped": "self-play"}
    _update_char_stat(db, winner.id, req.winner_char, "win",  req.winner_kills, req.loser_kills)
    _update_char_stat(db, loser.id,  req.loser_char,  "loss", req.loser_kills,  req.winner_kills)
    mr = MatchResult(
        winner_id=winner.id, winner_char=req.winner_char, winner_kills=req.winner_kills,
        loser_id=loser.id,   loser_char=req.loser_char,   loser_kills=req.loser_kills,
        bracket_id=req.bracket_id,
        match_key=req.match_key,
    )
    db.add(mr)
    db.commit()
    return {"ok": True}
