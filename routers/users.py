from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from datetime import datetime
from routers.ratelimit import rate_limit

from database import User, Bracket, MatchResult, ProfileComment
from auth import get_db, get_current_user

router = APIRouter(tags=["users"])


class AvatarUpdate(BaseModel):
    avatar_url: str


class CommentCreate(BaseModel):
    content: str


class FeaturedBadgeUpdate(BaseModel):
    badge_id: str  # e.g. "char_Joker" or "" to clear


class SetTestFlag(BaseModel):
    is_test: bool


@router.get("/users/me")
def get_me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.last_seen = datetime.utcnow()
    db.commit()
    return {"id": current_user.id, "username": current_user.username, "avatar_url": current_user.avatar_url,
            "featured_badge": current_user.featured_badge}


@router.put("/users/me/avatar")
def update_avatar(req: AvatarUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    url = req.avatar_url or None
    if url and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="Avatar URL must use HTTPS")
    current_user.avatar_url = url
    db.commit()
    return {"ok": True}


@router.patch("/users/me/featured-badge")
def set_featured_badge(req: FeaturedBadgeUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.featured_badge = req.badge_id.strip() or None
    db.commit()
    return {"ok": True}


@router.get("/users/all")
def all_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).filter(User.is_test == False).order_by(User.username).all()
    return [{"id": u.id, "username": u.username, "avatar_url": u.avatar_url} for u in users]


def _is_active(last_seen) -> bool:
    if not last_seen:
        return False
    return (datetime.utcnow() - last_seen).total_seconds() < 600


@router.get("/users/connections")
def list_connections(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    others = db.query(User).filter(
        User.is_test == current_user.is_test,
        User.id != current_user.id,
    ).order_by(User.username).all()
    return [{"id": u.id, "username": u.username, "avatar_url": u.avatar_url, "active": _is_active(u.last_seen)} for u in others]


@router.patch("/users/{username}/is_test")
def set_is_test(username: str, req: SetTestFlag, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Admin-only: hide/unhide an account from every listing, independent of username pattern."""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin only")
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.is_test = req.is_test
    db.commit()
    return {"ok": True, "username": user.username, "is_test": user.is_test}


@router.get("/users/search")
def search_users(q: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).filter(User.username.ilike(f"%{q}%"), User.is_test == False).limit(10).all()
    return [{"id": u.id, "username": u.username} for u in users if u.id != current_user.id]


@router.get("/users/{username}/profile")
def get_user_profile(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": user.id, "username": user.username, "avatar_url": user.avatar_url}


@router.get("/users/{username}/h2h/{other}")
def h2h(username: str, other: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    u1 = db.query(User).filter(User.username == username).first()
    u2 = db.query(User).filter(User.username == other).first()
    if not u1 or not u2:
        raise HTTPException(status_code=404, detail="User not found")

    wins_as_winner = db.query(MatchResult).filter(
        MatchResult.winner_id == u1.id, MatchResult.loser_id == u2.id
    ).all()
    wins_as_loser = db.query(MatchResult).filter(
        MatchResult.winner_id == u2.id, MatchResult.loser_id == u1.id
    ).all()

    chars = {}
    matchups = {}
    u1_total_kills = 0
    u2_total_kills = 0

    for r in wins_as_winner:
        c = r.winner_char
        wk = r.winner_kills or 0
        lk = r.loser_kills or 0
        chars.setdefault(c, {"wins": 0, "losses": 0, "kills": 0, "deaths": 0})
        chars[c]["wins"] += 1
        chars[c]["kills"] += wk
        chars[c]["deaths"] += lk
        u1_total_kills += wk
        u2_total_kills += lk
        key = f"{r.winner_char} vs {r.loser_char}"
        matchups.setdefault(key, {"user1_wins": 0, "user2_wins": 0, "user1_char": r.winner_char, "user2_char": r.loser_char, "user1_kills": 0, "user2_kills": 0})
        matchups[key]["user1_wins"] += 1
        matchups[key]["user1_kills"] += wk
        matchups[key]["user2_kills"] += lk

    for r in wins_as_loser:
        c = r.loser_char
        wk = r.winner_kills or 0
        lk = r.loser_kills or 0
        chars.setdefault(c, {"wins": 0, "losses": 0, "kills": 0, "deaths": 0})
        chars[c]["losses"] += 1
        chars[c]["kills"] += lk
        chars[c]["deaths"] += wk
        u1_total_kills += lk
        u2_total_kills += wk
        key = f"{r.loser_char} vs {r.winner_char}"
        matchups.setdefault(key, {"user1_wins": 0, "user2_wins": 0, "user1_char": r.loser_char, "user2_char": r.winner_char, "user1_kills": 0, "user2_kills": 0})
        matchups[key]["user2_wins"] += 1
        matchups[key]["user1_kills"] += lk
        matchups[key]["user2_kills"] += wk

    u1_wins = len(wins_as_winner)
    u2_wins = len(wins_as_loser)
    total   = u1_wins + u2_wins
    leader  = username if u1_wins > u2_wins else (other if u2_wins > u1_wins else None)
    return {
        "user1": username, "user1_wins": u1_wins, "user1_kills": u1_total_kills,
        "user2": other,    "user2_wins": u2_wins, "user2_kills": u2_total_kills,
        "total": total, "leader": leader,
        "chars": chars,
        "matchups": matchups,
    }


@router.get("/users/{username}/activity")
def activity(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    results = db.query(MatchResult).filter(
        or_(MatchResult.winner_id == user.id, MatchResult.loser_id == user.id)
    ).order_by(MatchResult.created_at.desc()).limit(20).all()
    return [{
        "id": r.id,
        "winner": r.winner.username,
        "winner_char": r.winner_char,
        "loser": r.loser.username,
        "loser_char": r.loser_char,
        "elo_delta": r.elo_delta or 0,
        "created_at": r.created_at.isoformat(),
    } for r in results]


@router.get("/users/{username}/comments")
def get_comments(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    comments = db.query(ProfileComment).filter(ProfileComment.target_id == user.id)\
        .order_by(ProfileComment.created_at.desc()).limit(50).all()
    return [{"id": c.id, "author": c.author.username, "author_avatar": c.author.avatar_url,
             "content": c.content, "created_at": c.created_at.isoformat()} for c in comments]


@router.post("/users/{username}/comments")
def post_comment(username: str, req: CommentCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rate_limit(request, max_req=10, window=60)
    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="Comment cannot be empty")
    if len(req.content) > 200:
        raise HTTPException(status_code=400, detail="Max 200 characters")
    comment = ProfileComment(author_id=current_user.id, target_id=target.id, content=req.content.strip())
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return {"id": comment.id, "author": current_user.username,
            "author_avatar": current_user.avatar_url,
            "content": comment.content, "created_at": comment.created_at.isoformat()}


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = db.query(ProfileComment).filter(ProfileComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Not found")
    if comment.author_id != current_user.id and comment.target_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    db.delete(comment)
    db.commit()
    return {"ok": True}


@router.get("/users/{username}/stats")
def get_user_stats(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    tournament_wins = db.query(Bracket).filter(Bracket.winner == username, Bracket.teams == None).count()
    three_stocks_given = db.query(MatchResult).filter(
        MatchResult.winner_id == user.id,
        MatchResult.winner_kills >= 3,
        MatchResult.loser_kills == 0,
    ).count()
    three_stocked_received = db.query(MatchResult).filter(
        MatchResult.loser_id == user.id,
        MatchResult.winner_kills >= 3,
        MatchResult.loser_kills == 0,
    ).count()
    return {
        "tournament_wins": tournament_wins,
        "three_stocks_given": three_stocks_given,
        "three_stocked_received": three_stocked_received,
    }


