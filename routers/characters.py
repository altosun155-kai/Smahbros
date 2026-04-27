import time
import threading
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from sqlalchemy import or_, and_
from database import User, CharacterRanking, CharacterStats, FavoriteCharacters, Friendship, CharacterMatchup
from auth import get_db, get_current_user

_avg_cache: dict = {"data": None, "ts": 0.0}
_avg_lock  = threading.Lock()
_AVG_TTL   = 60.0

router = APIRouter(tags=["characters"])


class RankingUpdate(BaseModel):
    ranking: dict


class FavoritesUpdate(BaseModel):
    characters: list


class StatRecord(BaseModel):
    character: str
    result: str  # "win" or "loss"


class StatRecordFor(BaseModel):
    username: str
    character: str
    result: str  # "win" or "loss"


class BulkStatEntry(BaseModel):
    character: str
    wins: int
    losses: int
    kills: int = 0
    deaths: int = 0


class BulkStatsRequest(BaseModel):
    username: str
    entries: list[BulkStatEntry]


def _stat_row(r):
    w = r.wins or 0
    l = r.losses or 0
    total = w + l
    win_pct = round(w / total * 100, 1) if total > 0 else None
    kills  = r.kills  or 0
    deaths = r.deaths or 0
    kd = round(kills / deaths, 2) if deaths > 0 else None
    return {
        "character": r.character,
        "points":    r.points,
        "elo":       r.elo if r.elo is not None else 1000,
        "kills":     kills,
        "deaths":    deaths,
        "kd":        kd,
        "wins":      w,
        "losses":    l,
        "win_pct":   win_pct,
    }


# ── Tier list / ranking ───────────────────────────────────────────────────────

@router.get("/characters/ranking")
def get_ranking(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cr = db.query(CharacterRanking).filter(CharacterRanking.owner_id == current_user.id).first()
    if not cr:
        return {"ranking": None, "updated_at": None}
    return {"ranking": cr.ranking, "updated_at": cr.updated_at.isoformat()}


@router.put("/characters/ranking")
def save_ranking(req: RankingUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cr = db.query(CharacterRanking).filter(CharacterRanking.owner_id == current_user.id).first()
    if cr:
        cr.ranking = req.ranking
        cr.updated_at = datetime.utcnow()
    else:
        cr = CharacterRanking(owner_id=current_user.id, ranking=req.ranking)
        db.add(cr)
    db.commit()
    return {"ok": True}


@router.get("/characters/ranking/{username}")
def get_ranking_by_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    cr = db.query(CharacterRanking).filter(CharacterRanking.owner_id == user.id).first()
    if not cr:
        raise HTTPException(status_code=404, detail="No tier list found for this user")
    return {"username": user.username, "ranking": cr.ranking, "updated_at": cr.updated_at.isoformat()}


# ── Favorites ─────────────────────────────────────────────────────────────────

@router.get("/characters/favorites")
def get_favorites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    fav = db.query(FavoriteCharacters).filter(FavoriteCharacters.owner_id == current_user.id).first()
    return {"characters": fav.characters if fav else []}


@router.get("/characters/favorites/{username}")
def get_favorites_by_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    fav = db.query(FavoriteCharacters).filter(FavoriteCharacters.owner_id == user.id).first()
    return {"username": user.username, "characters": fav.characters if fav else []}


@router.put("/characters/favorites")
def save_favorites(req: FavoritesUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    fav = db.query(FavoriteCharacters).filter(FavoriteCharacters.owner_id == current_user.id).first()
    if fav:
        fav.characters = req.characters
    else:
        fav = FavoriteCharacters(owner_id=current_user.id, characters=req.characters)
        db.add(fav)
    db.commit()
    return {"ok": True}


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/characters/stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(CharacterStats).filter(CharacterStats.user_id == current_user.id).all()
    return [_stat_row(r) for r in rows]


@router.get("/characters/mastery")
def character_mastery(db: Session = Depends(get_db)):
    """For each character, returns the user with the most points."""
    rows = db.query(CharacterStats).filter(CharacterStats.points > 0).all()
    char_map = {}
    for row in rows:
        char = row.character
        if char not in char_map or row.points > char_map[char]["points"]:
            char_map[char] = {
                "character": char,
                "username": row.owner.username,
                "avatar_url": row.owner.avatar_url,
                "points": row.points,
                "wins": row.wins or 0,
                "losses": row.losses or 0,
            }
    return list(char_map.values())


@router.get("/characters/mastery/friends")
def character_mastery_friends(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Returns character mastery scoped to the current user + their accepted friends."""
    friend_rows = db.query(Friendship).filter(
        Friendship.status == "accepted",
        or_(Friendship.requester_id == current_user.id, Friendship.addressee_id == current_user.id),
    ).all()
    friend_ids = {current_user.id}
    for row in friend_rows:
        friend_ids.add(row.addressee_id if row.requester_id == current_user.id else row.requester_id)

    rows = db.query(CharacterStats).filter(
        CharacterStats.user_id.in_(friend_ids),
        CharacterStats.points > 0,
    ).all()

    char_map = {}
    for row in rows:
        char = row.character
        if char not in char_map or row.points > char_map[char]["points"]:
            char_map[char] = {
                "character":  char,
                "username":   row.owner.username,
                "avatar_url": row.owner.avatar_url,
                "points":     row.points,
                "wins":       row.wins or 0,
                "losses":     row.losses or 0,
                "is_me":      row.user_id == current_user.id,
            }
    return list(char_map.values())


@router.get("/characters/stats/leaderboard")
def character_leaderboard(db: Session = Depends(get_db)):
    rows = db.query(CharacterStats).all()
    results = []
    for row in rows:
        w = row.wins or 0
        l = row.losses or 0
        total = w + l
        if row.points == 0 and (row.kills or 0) == 0 and total == 0:
            continue
        win_pct = round(w / total * 100, 1) if total >= 3 else None
        kills  = row.kills  or 0
        deaths = row.deaths or 0
        kd     = round(kills / deaths, 2) if deaths > 0 else None
        results.append({
            "username":   row.owner.username,
            "avatar_url": row.owner.avatar_url,
            "character":  row.character,
            "points":     row.points,
            "kills":      kills,
            "deaths":     deaths,
            "kd":         kd,
            "wins":       w,
            "losses":     l,
            "win_pct":    win_pct,
        })
    results.sort(key=lambda x: -x["points"])
    return results


@router.get("/characters/stats/leaderboard/kills")
def kills_leaderboard(db: Session = Depends(get_db)):
    rows = db.query(CharacterStats).filter(CharacterStats.kills > 0).order_by(CharacterStats.kills.desc()).all()
    return [
        {
            "username":   row.owner.username,
            "avatar_url": row.owner.avatar_url,
            "character":  row.character,
            "kills":      row.kills or 0,
            "points":     row.points,
        }
        for row in rows
    ]


@router.get("/characters/stats/leaderboard/winpct")
def winpct_leaderboard(db: Session = Depends(get_db)):
    # Filter at SQL level (#5)
    rows = db.query(CharacterStats).filter(
        (CharacterStats.wins + CharacterStats.losses) >= 3
    ).all()
    results = []
    for row in rows:
        w = row.wins or 0
        l = row.losses or 0
        total = w + l
        win_pct = round(w / total * 100, 1)
        results.append({
            "username":   row.owner.username,
            "avatar_url": row.owner.avatar_url,
            "character":  row.character,
            "win_pct":    win_pct,
            "wins":       w,
            "losses":     l,
            "points":     row.points,
        })
    results.sort(key=lambda x: (-x["win_pct"], -x["wins"]))
    return results


@router.get("/characters/stats/leaderboard/elo")
def elo_leaderboard(db: Session = Depends(get_db)):
    rows = db.query(CharacterStats).filter(
        (CharacterStats.wins + CharacterStats.losses) >= 3
    ).order_by(CharacterStats.elo.desc()).all()
    results = []
    for row in rows:
        w = row.wins or 0
        l = row.losses or 0
        total = w + l
        kills  = row.kills  or 0
        deaths = row.deaths or 0
        results.append({
            "username":   row.owner.username,
            "avatar_url": row.owner.avatar_url,
            "character":  row.character,
            "elo":        row.elo if row.elo is not None else 1000,
            "wins":       w,
            "losses":     l,
            "kills":      kills,
            "deaths":     deaths,
            "kd":         round(kills / deaths, 2) if deaths > 0 else None,
            "win_pct":    round(w / total * 100, 1) if total >= 3 else None,
            "points":     row.points or 0,
        })
    return results


@router.get("/characters/user-averages")
def user_averages_leaderboard(db: Session = Depends(get_db)):
    """Per-user average stats across all their characters, weighted and unweighted. Public (#15)."""
    now = time.monotonic()
    with _avg_lock:
        if _avg_cache["data"] is not None and now - _avg_cache["ts"] < _AVG_TTL:
            return _avg_cache["data"]

    all_stats = db.query(CharacterStats).filter(
        (CharacterStats.wins + CharacterStats.losses) >= 1
    ).all()

    # Global elo rank (1 = best) for chars with >= 3 games
    ranked_chars = sorted(
        [s for s in all_stats if (s.wins or 0) + (s.losses or 0) >= 3],
        key=lambda s: -(s.elo or 1000),
    )
    elo_rank_map = {s.id: i + 1 for i, s in enumerate(ranked_chars)}

    # Group by user
    from collections import defaultdict
    by_user = defaultdict(list)
    for s in all_stats:
        by_user[s.user_id].append(s)

    results = []
    for _uid, stats in by_user.items():
        user = stats[0].owner
        games_per = [(s.wins or 0) + (s.losses or 0) for s in stats]
        total_games = sum(games_per)
        total_wins  = sum(s.wins or 0 for s in stats)
        total_kills = sum(s.kills or 0 for s in stats)
        total_deaths = sum(s.deaths or 0 for s in stats)

        # Unweighted: simple mean per character slot
        elos   = [s.elo or 1000 for s in stats]
        kills_l = [s.kills or 0 for s in stats]
        kd_l   = [(s.kills or 0) / (s.deaths or 1) for s in stats if (s.deaths or 0) > 0]
        wp_l   = [(s.wins or 0) / g * 100 for s, g in zip(stats, games_per) if g > 0]
        ranks  = [elo_rank_map[s.id] for s in stats if s.id in elo_rank_map]

        unweighted = {
            "avg_elo":     round(sum(elos) / len(elos), 1),
            "avg_kills":   round(sum(kills_l) / len(kills_l), 1),
            "avg_kd":      round(sum(kd_l) / len(kd_l), 2)  if kd_l  else None,
            "avg_win_pct": round(sum(wp_l)  / len(wp_l),  1) if wp_l  else None,
            "avg_rank":    round(sum(ranks)  / len(ranks),  1) if ranks else None,
        }

        # Weighted formulas:
        # Elo   : Σ(elo × win_pct) / num_chars  — elo pulled up by win rate
        # Win%  : Σ(wins) / Σ(total matches)    — true overall win rate
        # K/D   : Σ(kd × elo) / Σ(elo)          — power-weighted by elo (screenshot 3)
        # Kills : total kills / total games       — kills per match
        # Only include chars that appear on the elo leaderboard (>= 3 games)
        lb_pairs = [(s.elo or 1000, (s.wins or 0) / g)
                    for s, g in zip(stats, games_per) if g >= 3]
        n_wp = len(lb_pairs)
        w_elo = (
            sum(e * wp for e, wp in lb_pairs) / n_wp
            if n_wp else unweighted["avg_elo"]
        )

        # Power K/D: Σ(kd_i × elo_i) / Σ(elo_i)
        kd_elo_pairs = [
            ((s.kills or 0) / (s.deaths or 1), s.elo or 1000)
            for s in stats if (s.deaths or 0) > 0
        ]
        total_elo_w = sum(e for _, e in kd_elo_pairs)
        power_kd = (
            round(sum(kd * e for kd, e in kd_elo_pairs) / total_elo_w, 2)
            if total_elo_w else None
        )

        ranked_games = sum(g for s, g in zip(stats, games_per) if s.id in elo_rank_map)
        w_rank = (
            sum(elo_rank_map[s.id] * g for s, g in zip(stats, games_per) if s.id in elo_rank_map) / ranked_games
            if ranked_games else None
        )

        weighted = {
            "avg_elo":     round(w_elo, 1),
            "avg_kills":   round(total_kills / total_games, 2) if total_games else 0,
            "avg_kd":      power_kd,
            "avg_win_pct": round(total_wins / total_games * 100, 1) if total_games else None,
            "avg_rank":    round(w_rank, 1) if w_rank else None,
        }

        results.append({
            "username":    user.username,
            "avatar_url":  user.avatar_url,
            "num_chars":   len(stats),
            "total_games": total_games,
            "unweighted":  unweighted,
            "weighted":    weighted,
        })

    with _avg_lock:
        _avg_cache["data"] = results
        _avg_cache["ts"]   = time.monotonic()
    return results


@router.get("/characters/stats/{username}")
def get_stats_by_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    rows = db.query(CharacterStats).filter(CharacterStats.user_id == user.id).all()
    return {"username": user.username, "stats": [_stat_row(r) for r in rows]}


@router.post("/characters/stats/bulk")
def bulk_set_stats(req: BulkStatsRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    target = db.query(User).filter(User.username == req.username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    for entry in req.entries:
        if not entry.character:
            continue
        row = db.query(CharacterStats).filter(
            CharacterStats.user_id == target.id,
            CharacterStats.character == entry.character,
        ).first()
        if row is None:
            row = CharacterStats(user_id=target.id, character=entry.character, points=0, elo=1000, kills=0, wins=0, losses=0)
            db.add(row)
        row.wins   = (row.wins   or 0) + entry.wins
        row.losses = (row.losses or 0) + entry.losses
        row.points = max(0, row.points + entry.wins - entry.losses)
        if entry.kills > 0:
            row.kills = (row.kills or 0) + entry.kills
        if entry.deaths > 0:
            row.deaths = (row.deaths or 0) + entry.deaths
    db.commit()
    return {"ok": True}


@router.post("/characters/stats/record-for")
def record_stat_for(req: StatRecordFor, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.result not in ("win", "loss"):
        raise HTTPException(status_code=400, detail="result must be 'win' or 'loss'")
    target = db.query(User).filter(User.username == req.username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    row = db.query(CharacterStats).filter(
        CharacterStats.user_id == target.id,
        CharacterStats.character == req.character,
    ).first()
    if row is None:
        row = CharacterStats(user_id=target.id, character=req.character, points=0, elo=1000, kills=0, wins=0, losses=0)
        db.add(row)
    if req.result == "win":
        row.points += 1
        row.wins = (row.wins or 0) + 1
    else:
        row.points = max(0, row.points - 1)
        row.losses = (row.losses or 0) + 1
    db.commit()
    return {"character": row.character, "points": row.points}


@router.get("/characters/matchup")
def get_matchup(a: str, b: str, db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Win counts for a character pair across all recorded matches (a's perspective)."""
    ca, cb = sorted([a, b])
    mu = db.query(CharacterMatchup).filter(
        CharacterMatchup.char_a == ca, CharacterMatchup.char_b == cb
    ).first()
    wa = (mu.wins_a or 0) if mu else 0
    wb = (mu.wins_b or 0) if mu else 0
    total = wa + wb
    wins_for_a, wins_for_b = (wa, wb) if a == ca else (wb, wa)
    return {"char_a": a, "char_b": b, "wins_a": wins_for_a, "wins_b": wins_for_b, "total": total}


@router.post("/characters/stats/record")
def record_stat(req: StatRecord, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.result not in ("win", "loss"):
        raise HTTPException(status_code=400, detail="result must be 'win' or 'loss'")
    row = db.query(CharacterStats).filter(
        CharacterStats.user_id == current_user.id,
        CharacterStats.character == req.character,
    ).first()
    if row is None:
        row = CharacterStats(user_id=current_user.id, character=req.character, points=0, elo=1000, kills=0, wins=0, losses=0)
        db.add(row)
    if req.result == "win":
        row.points += 1
        row.wins = (row.wins or 0) + 1
    else:
        row.points = max(0, row.points - 1)
        row.losses = (row.losses or 0) + 1
    db.commit()
    return {"character": row.character, "points": row.points}
