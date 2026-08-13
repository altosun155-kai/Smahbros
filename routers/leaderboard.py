import time
import threading
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import User, MatchResult
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

    # Aggregate wins/losses/kills per user from real match history, in
    # chronological order so we can also derive each player's current
    # trailing win streak (consecutive wins ending at their most recent match).
    all_matches = db.query(MatchResult).all()
    sorted_matches = sorted(all_matches, key=lambda m: m.created_at or datetime(2000, 1, 1))

    stats: dict = {}
    user_match_history: dict = {}   # uid -> [(is_win, match), ...] in chronological order
    for m in sorted_matches:
        w = stats.setdefault(m.winner_id, {"wins": 0, "losses": 0, "kills": 0})
        w["wins"] += 1
        w["kills"] += m.winner_kills or 0
        l = stats.setdefault(m.loser_id, {"wins": 0, "losses": 0, "kills": 0})
        l["losses"] += 1
        l["kills"] += m.loser_kills or 0
        user_match_history.setdefault(m.winner_id, []).append((True, m))
        user_match_history.setdefault(m.loser_id, []).append((False, m))

    def _current_streak(uid: int) -> int:
        streak = 0
        for is_win, _m in reversed(user_match_history.get(uid, [])):
            if not is_win:
                break
            streak += 1
        return streak

    result = []
    if stats:
        for u in db.query(User).filter(User.id.in_(stats.keys()), User.is_test == False).all():
            s = stats[u.id]
            total = s["wins"] + s["losses"]
            # Rank by win rate for qualified players; raw wins as secondary (#1)
            win_rate = round(s["wins"] / total * 100, 1) if total >= MIN_RANKED_GAMES else None
            result.append({
                "username":   u.username,
                "avatar_url": u.avatar_url,
                "wins":       s["wins"],
                "losses":     s["losses"],
                "kills":      s["kills"],
                "win_rate":   win_rate,
                "player_elo": u.elo or 1000,
                "streak":     _current_streak(u.id),
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
    users = db.query(User.id, User.username).filter(User.id.in_(user_ids), User.is_test == False).all()
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
