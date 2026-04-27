import time
import threading
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from database import User, RoundRobinResult, MatchResult
from auth import get_db

router = APIRouter(tags=["leaderboard"])

# ── 60-second TTL caches ─────────────────────────────────────────────────────
_lb_cache: dict = {"data": None, "ts": 0.0}
_lb_lock  = threading.Lock()
_LB_TTL   = 60.0

_matrix_cache: dict = {"data": None, "ts": 0.0}
_matrix_lock  = threading.Lock()

MIN_RANKED_GAMES = 5   # need this many games to be ranked by win rate


@router.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db)):
    now = time.monotonic()
    with _lb_lock:
        if _lb_cache["data"] is not None and now - _lb_cache["ts"] < _LB_TTL:
            return _lb_cache["data"]

    # Only load users that actually have RR sessions (SQL-level filter, #3)
    users = (
        db.query(User)
        .join(RoundRobinResult, RoundRobinResult.user_id == User.id)
        .options(joinedload(User.rr_sessions))
        .distinct()
        .all()
    )
    result = []
    for u in users:
        sessions = len(u.rr_sessions)
        wins = losses = kills = 0
        for rr in u.rr_sessions:
            for rec in (rr.records or {}).values():
                if isinstance(rec, dict):
                    # Normalise inconsistent key casing (#4)
                    wins   += rec.get("wins",   rec.get("Wins",   0))
                    losses += rec.get("losses", rec.get("Losses", 0))
                    kills  += rec.get("kills",  0)
        total = wins + losses
        # Rank by win rate for qualified players; raw wins as secondary (#1)
        win_rate = round(wins / total * 100, 1) if total >= MIN_RANKED_GAMES else None
        result.append({
            "username":   u.username,
            "avatar_url": u.avatar_url,
            "wins":       wins,
            "losses":     losses,
            "kills":      kills,
            "sessions":   sessions,
            "win_rate":   win_rate,
            "player_elo": u.elo or 1000,
        })

    # Qualified players sorted by win rate; unqualified at bottom by raw wins (#1)
    result.sort(key=lambda x: (
        0 if x["win_rate"] is not None else 1,
        -(x["win_rate"] or 0),
        -(x["wins"] + x["losses"]),
    ))

    with _lb_lock:
        _lb_cache["data"] = result
        _lb_cache["ts"]   = time.monotonic()
    return result


@router.get("/leaderboard/h2h-matrix")
def h2h_matrix(db: Session = Depends(get_db)):
    """Single endpoint returning all head-to-head win counts. Replaces N*(N-1)/2 calls (#10)."""
    now = time.monotonic()
    with _matrix_lock:
        if _matrix_cache["data"] is not None and now - _matrix_cache["ts"] < _LB_TTL:
            return _matrix_cache["data"]

    rows = (
        db.query(MatchResult.winner_id, MatchResult.loser_id, func.count().label("cnt"))
        .group_by(MatchResult.winner_id, MatchResult.loser_id)
        .all()
    )
    user_ids = {r.winner_id for r in rows} | {r.loser_id for r in rows}
    users = db.query(User.id, User.username).filter(User.id.in_(user_ids)).all()
    uid_to_name = {u.id: u.username for u in users}

    # {winner_username: {loser_username: win_count}}
    matrix: dict = {}
    for row in rows:
        w = uid_to_name.get(row.winner_id)
        l = uid_to_name.get(row.loser_id)
        if w and l:
            matrix.setdefault(w, {})[l] = row.cnt

    with _matrix_lock:
        _matrix_cache["data"] = matrix
        _matrix_cache["ts"]   = time.monotonic()
    return matrix
