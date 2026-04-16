from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import User
from auth import get_db

router = APIRouter(tags=["leaderboard"])


@router.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db)):
    users = db.query(User).all()
    result = []
    for u in users:
        sessions = len(u.rr_sessions)
        if sessions == 0:
            continue
        wins = 0
        losses = 0
        kills = 0
        for rr in u.rr_sessions:
            for rec in (rr.records or {}).values():
                if isinstance(rec, dict):
                    wins   += rec.get("wins",   rec.get("Wins",   0))
                    losses += rec.get("losses", rec.get("Losses", 0))
                    kills  += rec.get("kills",  0)
        result.append({"username": u.username, "wins": wins, "losses": losses, "kills": kills, "sessions": sessions})
    result.sort(key=lambda x: (-x["wins"], x["losses"]))
    return result
