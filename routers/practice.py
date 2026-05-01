from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from collections import defaultdict

from database import User, PracticeSession, CharacterStats
from auth import get_db, get_current_user

# CPU Elo ratings by level (Level 1 = 800, incrementing by 50)
_CPU_ELO = {i: 800 + (i - 1) * 50 for i in range(1, 10)}
_K_PRACTICE   = 32   # K for normal sessions (6+)
_K_PLACEMENT  = 48   # K for placement sessions (higher swing to find true level faster)
_MIN_LOSS     = 5    # minimum Elo lost per session regardless of expected outcome
_PLACEMENT_START = 800   # start at the floor — placement earns your way up
_PLACEMENT_MATCHES = 5


def _apply_elo_step(elo: int, cpu_level: int, won: bool, k: int) -> tuple[int, int]:
    """Returns (new_elo, delta)."""
    cpu_elo = _CPU_ELO.get(cpu_level, 2000)
    expected = 1 / (1 + 10 ** ((cpu_elo - elo) / 400))
    if won:
        delta = max(1, round(k * (1 - expected)))
    else:
        delta = -max(_MIN_LOSS, round(k * expected))
    return max(100, elo + delta), delta


def _calculate_placement_elo(sessions: list) -> int:
    """Run all placement sessions through the formula starting from neutral 1200."""
    elo = _PLACEMENT_START
    for s in sessions:
        elo, _ = _apply_elo_step(elo, s["cpu_level"], s["won"], _K_PLACEMENT)
    return elo

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
        "elo_delta": s.elo_delta or 0,
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

    # Fetch practice_elo for all of the user's characters in one query
    stat_rows = db.query(CharacterStats).filter_by(user_id=current_user.id).all()
    practice_elo_map = {r.character: r.practice_elo for r in stat_rows}

    # Attach elo to each char entry (None = still in placement)
    chars_out = {
        c: {**v, "elo": practice_elo_map.get(c)}
        for c, v in chars.items()
    }

    # Single-char mode: also return top-level elo/placement fields
    practice_elo = practice_elo_map.get(character) if character else None

    return {
        "total": total,
        "wins": wins,
        "losses": total - wins,
        "win_pct": round(wins / total * 100, 1) if total else None,
        "matchups": dict(matchups),
        "levels": {str(k): v for k, v in levels.items()},
        "chars": chars_out,
        "elo": practice_elo,
        "placement_done": practice_elo is not None,
        "placement_matches": _PLACEMENT_MATCHES,
    }


@router.post("/practice/sessions")
def log_session(
    req: SessionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Get or create CharacterStats (practice_elo starts NULL — unplaced)
    stat = db.query(CharacterStats).filter_by(user_id=current_user.id, character=req.my_char).first()
    if stat is None:
        stat = CharacterStats(user_id=current_user.id, character=req.my_char,
                              points=0, elo=1000, kills=0, deaths=0, wins=0, losses=0,
                              practice_elo=None)
        db.add(stat)
        db.flush()

    # Count practice sessions logged BEFORE this one
    prior_count = db.query(PracticeSession).filter_by(
        user_id=current_user.id, my_char=req.my_char
    ).count()

    delta = 0
    if prior_count < _PLACEMENT_MATCHES - 1:
        # Sessions 1–4: in placement, no Elo change yet
        delta = 0
    elif prior_count == _PLACEMENT_MATCHES - 1:
        # Session 5: calculate placement Elo from all 5 matches
        prev = db.query(PracticeSession).filter_by(
            user_id=current_user.id, my_char=req.my_char
        ).order_by(PracticeSession.created_at).all()
        all_five = [{"cpu_level": s.cpu_level, "won": s.won} for s in prev]
        all_five.append({"cpu_level": req.cpu_level, "won": req.won})
        placement_elo = _calculate_placement_elo(all_five)
        delta = placement_elo - _PLACEMENT_START
        stat.practice_elo = placement_elo
    else:
        # Sessions 6+: normal Elo update
        cur_elo = stat.practice_elo or _PLACEMENT_START
        new_elo, delta = _apply_elo_step(cur_elo, req.cpu_level, req.won, _K_PRACTICE)
        stat.practice_elo = new_elo

    s = PracticeSession(
        user_id=current_user.id,
        my_char=req.my_char,
        cpu_char=req.cpu_char,
        cpu_level=req.cpu_level,
        my_stocks=req.my_stocks,
        cpu_stocks=req.cpu_stocks,
        won=req.won,
        notes=req.notes or None,
        elo_delta=delta,
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
