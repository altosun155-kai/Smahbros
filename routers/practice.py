from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from collections import defaultdict

from database import User, PracticeSession
from auth import get_db, get_current_user

router = APIRouter(tags=["practice"])


class SessionCreate(BaseModel):
    my_char: str
    cpu_char: str
    cpu_level: int = 9
    my_stocks: int = 3
    cpu_stocks: int = 0
    won: bool = True
    notes: str | None = None


def _fmt(s: PracticeSession) -> dict:
    return {
        "id": s.id,
        "my_char": s.my_char,
        "cpu_char": s.cpu_char,
        "cpu_level": s.cpu_level,
        "my_stocks": s.my_stocks,
        "cpu_stocks": s.cpu_stocks,
        "won": s.won,
        "notes": s.notes,
        "created_at": s.created_at.isoformat(),
    }


@router.get("/practice/sessions")
def get_sessions(
    character: str | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(PracticeSession).filter(PracticeSession.user_id == current_user.id)
    if character:
        q = q.filter(PracticeSession.my_char == character)
    return [_fmt(s) for s in q.order_by(PracticeSession.created_at.desc()).limit(limit).all()]


@router.get("/practice/stats")
def get_stats(
    character: str | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(PracticeSession).filter(PracticeSession.user_id == current_user.id)
    if character:
        q = q.filter(PracticeSession.my_char == character)
    sessions = q.all()

    total = len(sessions)
    wins  = sum(1 for s in sessions if s.won)

    matchups: dict = defaultdict(lambda: {"wins": 0, "total": 0})
    levels:   dict = defaultdict(lambda: {"wins": 0, "total": 0})
    chars:    dict = defaultdict(lambda: {"wins": 0, "total": 0})

    for s in sessions:
        matchups[s.cpu_char]["total"] += 1
        if s.won:
            matchups[s.cpu_char]["wins"] += 1
        levels[s.cpu_level]["total"] += 1
        if s.won:
            levels[s.cpu_level]["wins"] += 1
        chars[s.my_char]["total"] += 1
        if s.won:
            chars[s.my_char]["wins"] += 1

    return {
        "total": total,
        "wins": wins,
        "losses": total - wins,
        "win_pct": round(wins / total * 100, 1) if total else None,
        "matchups": dict(matchups),
        "levels": {str(k): v for k, v in levels.items()},
        "chars": dict(chars),
    }


@router.post("/practice/sessions")
def log_session(
    req: SessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = PracticeSession(
        user_id=current_user.id,
        my_char=req.my_char,
        cpu_char=req.cpu_char,
        cpu_level=req.cpu_level,
        my_stocks=req.my_stocks,
        cpu_stocks=req.cpu_stocks,
        won=req.won,
        notes=req.notes or None,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _fmt(s)


@router.delete("/practice/sessions/{session_id}")
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(PracticeSession).filter(
        PracticeSession.id == session_id,
        PracticeSession.user_id == current_user.id,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(s)
    db.commit()
    return {"ok": True}
