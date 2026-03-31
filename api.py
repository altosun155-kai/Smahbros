from fastapi import FastAPI, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from database import engine, Base, User, Bracket, RoundRobinResult, CharacterRanking, TournamentInvite, FavoriteCharacters, CharacterStats
from auth import get_db, get_current_user, hash_password, verify_password, create_access_token

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Smash Bracket API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# ── Favorite Characters ───────────────────────────────────────────────────────

class FavoritesUpdate(BaseModel):
    characters: list


@app.get("/characters/favorites")
def get_favorites(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    fav = db.query(FavoriteCharacters).filter(FavoriteCharacters.owner_id == current_user.id).first()
    return {"characters": fav.characters if fav else []}


@app.put("/characters/favorites")
def save_favorites(req: FavoritesUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    fav = db.query(FavoriteCharacters).filter(FavoriteCharacters.owner_id == current_user.id).first()
    if fav:
        fav.characters = req.characters
    else:
        fav = FavoriteCharacters(owner_id=current_user.id, characters=req.characters)
        db.add(fav)
    db.commit()
    return {"ok": True}


# ── Character Stats ───────────────────────────────────────────────────────────

class StatRecord(BaseModel):
    character: str
    result: str  # "win" or "loss"


@app.get("/characters/stats")
def get_stats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(CharacterStats).filter(CharacterStats.user_id == current_user.id).all()
    return [{"character": r.character, "points": r.points} for r in rows]


@app.get("/characters/stats/{username}")
def get_stats_by_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    rows = db.query(CharacterStats).filter(CharacterStats.user_id == user.id).all()
    return {"username": user.username, "stats": [{"character": r.character, "points": r.points} for r in rows]}


@app.get("/characters/stats/leaderboard")
def character_leaderboard(db: Session = Depends(get_db)):
    """For each character, return the player with the most points."""
    rows = db.query(CharacterStats).filter(CharacterStats.points > 0).all()
    char_top: dict = {}
    for row in rows:
        if row.character not in char_top or row.points > char_top[row.character]["points"]:
            char_top[row.character] = {
                "character": row.character,
                "points": row.points,
                "username": row.owner.username,
                "avatar_url": row.owner.avatar_url,
            }
    result = list(char_top.values())
    result.sort(key=lambda x: -x["points"])
    return result


@app.post("/characters/stats/record")
def record_stat(req: StatRecord, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.result not in ("win", "loss"):
        raise HTTPException(status_code=400, detail="result must be 'win' or 'loss'")
    row = db.query(CharacterStats).filter(
        CharacterStats.user_id == current_user.id,
        CharacterStats.character == req.character,
    ).first()
    if row is None:
        row = CharacterStats(user_id=current_user.id, character=req.character, points=0)
        db.add(row)
    if req.result == "win":
        row.points += 1
    else:
        row.points = max(0, row.points - 1)
    db.commit()
    return {"character": row.character, "points": row.points}


# ── User profile ──────────────────────────────────────────────────────────────

class AvatarUpdate(BaseModel):
    avatar_url: str


@app.get("/users/me")
def get_me(current_user: User = Depends(get_current_user)):
    return {"id": current_user.id, "username": current_user.username, "avatar_url": current_user.avatar_url}


@app.put("/users/me/avatar")
def update_avatar(req: AvatarUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.avatar_url = req.avatar_url or None
    db.commit()
    return {"ok": True}
