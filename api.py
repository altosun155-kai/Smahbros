from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
import os

from database import SessionLocal, engine, Base, User, Bracket, RoundRobinResult, CharacterRanking, TournamentInvite

Base.metadata.create_all(bind=engine)

SECRET_KEY = os.environ.get("SECRET_KEY", "changeme-set-SECRET_KEY-env-var")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

app = FastAPI(title="Smash Bracket API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def hash_password(pw: str) -> str:
    return pwd_context.hash(pw)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    credentials_exception = HTTPException(status_code=401, detail="Invalid credentials")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise credentials_exception
    return user


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str


@app.post("/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    user = User(username=req.username, hashed_password=hash_password(req.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return {"id": user.id, "username": user.username}


@app.post("/auth/login")
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    token = create_access_token({"sub": user.username})
    return {"access_token": token, "token_type": "bearer"}


# ── Users ─────────────────────────────────────────────────────────────────────

@app.get("/users/search")
def search_users(q: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).filter(User.username.ilike(f"%{q}%")).limit(10).all()
    return [{"id": u.id, "username": u.username} for u in users if u.id != current_user.id]


# ── Brackets ──────────────────────────────────────────────────────────────────

class BracketCreate(BaseModel):
    name: str
    mode: str = "regular"
    players: list = []
    entries: list = []
    bracket_data: list = []


@app.get("/brackets")
def list_brackets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    brackets = (
        db.query(Bracket)
        .filter(Bracket.user_id == current_user.id)
        .order_by(Bracket.created_at.desc())
        .all()
    )
    return [
        {"id": b.id, "name": b.name, "mode": b.mode, "winner": b.winner, "created_at": b.created_at.isoformat()}
        for b in brackets
    ]


@app.post("/brackets")
def create_bracket(req: BracketCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bracket = Bracket(
        user_id=current_user.id,
        name=req.name,
        mode=req.mode,
        players=req.players,
        entries=req.entries,
        bracket_data=req.bracket_data,
    )
    db.add(bracket)
    db.commit()
    db.refresh(bracket)
    return {"id": bracket.id, "name": bracket.name}


@app.delete("/brackets/{bracket_id}")
def delete_bracket(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bracket = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id).first()
    if not bracket:
        raise HTTPException(status_code=404, detail="Bracket not found")
    db.delete(bracket)
    db.commit()
    return {"ok": True}


# ── Round Robin ───────────────────────────────────────────────────────────────

class RRCreate(BaseModel):
    name: str
    players: list
    results: dict
    records: dict


@app.get("/roundrobin")
def list_rr(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sessions = (
        db.query(RoundRobinResult)
        .filter(RoundRobinResult.user_id == current_user.id)
        .order_by(RoundRobinResult.created_at.desc())
        .all()
    )
    return [{"id": s.id, "name": s.name, "created_at": s.created_at.isoformat()} for s in sessions]


@app.get("/roundrobin/{rr_id}")
def get_rr(rr_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = db.query(RoundRobinResult).filter(
        RoundRobinResult.id == rr_id, RoundRobinResult.user_id == current_user.id
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"id": s.id, "name": s.name, "players": s.players, "results": s.results, "records": s.records}


@app.post("/roundrobin")
def create_rr(req: RRCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = RoundRobinResult(
        user_id=current_user.id,
        name=req.name,
        players=req.players,
        results=req.results,
        records=req.records,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return {"id": s.id, "name": s.name}


# ── Character Rankings / Tier List ────────────────────────────────────────────

class RankingUpdate(BaseModel):
    ranking: dict


@app.get("/characters/ranking")
def get_ranking(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cr = db.query(CharacterRanking).filter(CharacterRanking.owner_id == current_user.id).first()
    if not cr:
        return {"ranking": None, "updated_at": None}
    return {"ranking": cr.ranking, "updated_at": cr.updated_at.isoformat()}


@app.put("/characters/ranking")
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


@app.get("/characters/ranking/{username}")
def get_ranking_by_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    cr = db.query(CharacterRanking).filter(CharacterRanking.owner_id == user.id).first()
    if not cr:
        raise HTTPException(status_code=404, detail="No tier list found for this user")
    return {"username": user.username, "ranking": cr.ranking, "updated_at": cr.updated_at.isoformat()}


# ── Tournament Invites ────────────────────────────────────────────────────────

class InviteCreate(BaseModel):
    bracket_id: int
    invitee_username: str


class InviteUpdate(BaseModel):
    status: str


@app.get("/invites/received")
def get_received_invites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    invites = (
        db.query(TournamentInvite)
        .filter(TournamentInvite.invitee_id == current_user.id)
        .order_by(TournamentInvite.created_at.desc())
        .all()
    )
    return [
        {
            "id": i.id,
            "bracket_id": i.bracket_id,
            "bracket_name": i.bracket.name,
            "inviter": i.inviter.username,
            "status": i.status,
            "created_at": i.created_at.isoformat(),
        }
        for i in invites
    ]


@app.get("/invites/sent")
def get_sent_invites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    invites = (
        db.query(TournamentInvite)
        .filter(TournamentInvite.inviter_id == current_user.id)
        .order_by(TournamentInvite.created_at.desc())
        .all()
    )
    return [
        {
            "id": i.id,
            "bracket_id": i.bracket_id,
            "bracket_name": i.bracket.name,
            "invitee": i.invitee.username,
            "status": i.status,
            "created_at": i.created_at.isoformat(),
        }
        for i in invites
    ]


@app.get("/invites/bracket/{bracket_id}")
def get_bracket_invites(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bracket = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id).first()
    if not bracket:
        raise HTTPException(status_code=404, detail="Bracket not found")
    invites = db.query(TournamentInvite).filter(TournamentInvite.bracket_id == bracket_id).all()
    return [
        {
            "id": i.id,
            "invitee": i.invitee.username,
            "status": i.status,
            "created_at": i.created_at.isoformat(),
        }
        for i in invites
    ]


@app.post("/invites")
def send_invite(req: InviteCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bracket = db.query(Bracket).filter(Bracket.id == req.bracket_id, Bracket.user_id == current_user.id).first()
    if not bracket:
        raise HTTPException(status_code=404, detail="Bracket not found")
    invitee = db.query(User).filter(User.username == req.invitee_username).first()
    if not invitee:
        raise HTTPException(status_code=404, detail="User not found")
    existing = db.query(TournamentInvite).filter(
        TournamentInvite.bracket_id == req.bracket_id,
        TournamentInvite.invitee_id == invitee.id,
        TournamentInvite.status == "pending",
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Pending invite already exists")
    invite = TournamentInvite(bracket_id=req.bracket_id, inviter_id=current_user.id, invitee_id=invitee.id)
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return {"id": invite.id}


@app.patch("/invites/{invite_id}")
def update_invite(invite_id: int, req: InviteUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.status not in ("accepted", "declined"):
        raise HTTPException(status_code=400, detail="status must be 'accepted' or 'declined'")
    invite = db.query(TournamentInvite).filter(
        TournamentInvite.id == invite_id,
        TournamentInvite.invitee_id == current_user.id,
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    invite.status = req.status
    db.commit()
    return {"ok": True}


@app.delete("/invites/{invite_id}")
def cancel_invite(invite_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    invite = db.query(TournamentInvite).filter(
        TournamentInvite.id == invite_id,
        TournamentInvite.inviter_id == current_user.id,
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    db.delete(invite)
    db.commit()
    return {"ok": True}


# ── Global Leaderboard ────────────────────────────────────────────────────────

@app.get("/leaderboard")
def leaderboard(db: Session = Depends(get_db)):
    users = db.query(User).all()
    result = []
    for u in users:
        sessions = len(u.rr_sessions)
        if sessions == 0:
            continue
        wins = 0
        losses = 0
        for rr in u.rr_sessions:
            for rec in (rr.records or {}).values():
                if isinstance(rec, dict):
                    wins += rec.get("Wins", 0)
                    losses += rec.get("Losses", 0)
        result.append({"username": u.username, "wins": wins, "losses": losses, "sessions": sessions})
    result.sort(key=lambda x: (-x["wins"], x["losses"]))
    return result
