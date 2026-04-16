from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from datetime import datetime

from database import User, Friendship
from auth import get_db, get_current_user

router = APIRouter(prefix="/friends", tags=["friends"])


def _is_active(last_seen) -> bool:
    if not last_seen:
        return False
    return (datetime.utcnow() - last_seen).total_seconds() < 600


def _friend_entry(other: User) -> dict:
    return {
        "id": other.id,
        "username": other.username,
        "avatar_url": other.avatar_url,
        "active": _is_active(other.last_seen),
    }


@router.get("")
def list_friends(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Friendship).filter(
        Friendship.status == "accepted",
        or_(Friendship.requester_id == current_user.id, Friendship.addressee_id == current_user.id),
    ).all()
    friends = []
    for row in rows:
        other = row.addressee if row.requester_id == current_user.id else row.requester
        friends.append(_friend_entry(other))
    return friends


@router.get("/requests")
def list_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Friendship).filter(
        Friendship.addressee_id == current_user.id,
        Friendship.status == "pending",
    ).all()
    return [{"id": r.id, "username": r.requester.username, "avatar_url": r.requester.avatar_url} for r in rows]


@router.post("/request")
def send_friend_request(body: dict, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    username = body.get("username", "").strip()
    target = db.query(User).filter(User.username == username).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot add yourself")
    existing = db.query(Friendship).filter(
        or_(
            and_(Friendship.requester_id == current_user.id, Friendship.addressee_id == target.id),
            and_(Friendship.requester_id == target.id, Friendship.addressee_id == current_user.id),
        )
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Request already exists or already friends")
    f = Friendship(requester_id=current_user.id, addressee_id=target.id)
    db.add(f)
    db.commit()
    return {"ok": True}


@router.post("/accept/{request_id}")
def accept_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(Friendship).filter(
        Friendship.id == request_id, Friendship.addressee_id == current_user.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    row.status = "accepted"
    db.commit()
    return {"ok": True}


@router.delete("/request/{request_id}")
def decline_or_cancel_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(Friendship).filter(
        Friendship.id == request_id,
        or_(Friendship.requester_id == current_user.id, Friendship.addressee_id == current_user.id),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    db.delete(row)
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}")
def remove_friend(user_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(Friendship).filter(
        Friendship.status == "accepted",
        or_(
            and_(Friendship.requester_id == current_user.id, Friendship.addressee_id == user_id),
            and_(Friendship.requester_id == user_id, Friendship.addressee_id == current_user.id),
        ),
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not friends")
    db.delete(row)
    db.commit()
    return {"ok": True}
