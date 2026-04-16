from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel
from datetime import datetime

from database import User, Bracket, CharacterStats, MatchResult, ProfileComment
from auth import get_db, get_current_user

router = APIRouter(tags=["users"])


class AvatarUpdate(BaseModel):
    avatar_url: str


class CommentCreate(BaseModel):
    content: str


@router.get("/users/me")
def get_me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.last_seen = datetime.utcnow()
    db.commit()
    return {"id": current_user.id, "username": current_user.username, "avatar_url": current_user.avatar_url}


@router.put("/users/me/avatar")
def update_avatar(req: AvatarUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.avatar_url = req.avatar_url or None
    db.commit()
    return {"ok": True}


@router.get("/users/all")
def all_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).order_by(User.username).all()
    return [{"id": u.id, "username": u.username, "avatar_url": u.avatar_url} for u in users]


@router.get("/users/search")
def search_users(q: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).filter(User.username.ilike(f"%{q}%")).limit(10).all()
    return [{"id": u.id, "username": u.username} for u in users if u.id != current_user.id]


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
    for r in wins_as_winner:
        c = r.winner_char
        chars.setdefault(c, {"wins": 0, "losses": 0})
        chars[c]["wins"] += 1
    for r in wins_as_loser:
        c = r.loser_char
        chars.setdefault(c, {"wins": 0, "losses": 0})
        chars[c]["losses"] += 1

    u1_wins = len(wins_as_winner)
    u2_wins = len(wins_as_loser)
    total   = u1_wins + u2_wins
    leader  = username if u1_wins > u2_wins else (other if u2_wins > u1_wins else None)
    return {
        "user1": username, "user1_wins": u1_wins,
        "user2": other,    "user2_wins": u2_wins,
        "total": total, "leader": leader,
        "chars": chars,
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
def post_comment(username: str, req: CommentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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


@router.get("/users/{username}/badges")
def get_badges(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    badges = []
    stats = db.query(CharacterStats).filter(CharacterStats.user_id == user.id, CharacterStats.points > 0).all()
    if stats:
        best = max(stats, key=lambda s: s.points)
        if best.points >= 10:
            badges.append({"id": "specialist", "label": f"{best.character} Specialist",
                           "desc": f"{best.points} pts with {best.character}", "color": "#f5a623"})
        chars_with_pts = len([s for s in stats if s.points > 0])
        if chars_with_pts >= 5:
            badges.append({"id": "allrounder", "label": "All-Rounder",
                           "desc": f"Points with {chars_with_pts} characters", "color": "#27ae60"})
        if len([s for s in stats if s.points >= 10]) >= 3:
            badges.append({"id": "consistent", "label": "Consistent",
                           "desc": "3+ characters at 10+ pts each", "color": "#3498db"})
    champion = db.query(Bracket).filter(Bracket.winner == username).first()
    if champion:
        badges.append({"id": "champion", "label": "Bracket Champion",
                       "desc": f'Won "{champion.name}"', "color": "#e74c3c"})
    top_rows = db.query(CharacterStats).filter(CharacterStats.points > 0)\
        .order_by(CharacterStats.points.desc()).limit(3).all()
    if any(r.owner.username == username for r in top_rows):
        badges.append({"id": "top3", "label": "Top Performer",
                       "desc": "Top 3 on the character leaderboard", "color": "#9b59b6"})
    match_count = db.query(MatchResult).filter(
        or_(MatchResult.winner_id == user.id, MatchResult.loser_id == user.id)
    ).count()
    if match_count >= 20:
        badges.append({"id": "veteran", "label": "Veteran",
                       "desc": f"{match_count} matches played", "color": "#1abc9c"})
    return badges
