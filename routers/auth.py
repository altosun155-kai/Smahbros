import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import User
from auth import get_db, hash_password, make_token
from routers.ratelimit import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])


class EnterRequest(BaseModel):
    username: str


@router.get("/users")
def list_users(request: Request, db: Session = Depends(get_db)):
    rate_limit(request, max_req=30, window=60)
    usernames = [u.username for u in db.query(User).order_by(User.username.asc()).all()]
    return {"usernames": usernames}


@router.post("/enter")
def enter(req: EnterRequest, request: Request, db: Session = Depends(get_db)):
    rate_limit(request, max_req=10, window=60)

    name = req.username.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Enter a name")
    if len(name) > 24:
        raise HTTPException(status_code=400, detail="Name is too long")

    user = db.query(User).filter(func.lower(User.username) == name.lower()).first()
    if not user:
        user = User(username=name, hashed_password=hash_password(secrets.token_urlsafe(24)))
        db.add(user)
        db.commit()
        db.refresh(user)

    return {"token": make_token(user.id), "username": user.username}
