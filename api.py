from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
import os

from database import engine, Base, User, Bracket, RoundRobinResult, CharacterRanking, TournamentInvite, FavoriteCharacters, CharacterStats, Friendship, MatchResult, ProfileComment
from auth import get_db, get_current_user, hash_password, verify_password, make_token
from sqlalchemy import or_, and_, text

Base.metadata.create_all(bind=engine)

# Add any missing columns that were added after initial table creation
def _run_migrations():
    is_pg = not str(engine.url).startswith("sqlite")
    with engine.connect() as conn:
        if is_pg:
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS round_winners JSONB DEFAULT '{}'"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS bracket_style VARCHAR DEFAULT 'strongVsStrong'"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS winner VARCHAR"))
        else:
            # SQLite: check pragma
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(brackets)"))}
            if "round_winners" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN round_winners TEXT DEFAULT '{}'"))
            if "bracket_style" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN bracket_style VARCHAR DEFAULT 'strongVsStrong'"))
            if "is_live" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN is_live BOOLEAN DEFAULT 0"))
            if "winner" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN winner VARCHAR"))
        conn.commit()

_run_migrations()

app = FastAPI(title="Smash Bracket API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the web/ frontend — mount AFTER all API routes are defined (see bottom of file)
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


@app.get("/health")
def health():
    return {"ok": True}


# ── Auth ──────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
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
    return {"token": make_token(user.id), "username": user.username}


@app.post("/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    return {"token": make_token(user.id), "username": user.username}


# ── Users ─────────────────────────────────────────────────────────────────────

@app.get("/users/all")
def all_users(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    users = db.query(User).order_by(User.username).all()
    return [{"id": u.id, "username": u.username, "avatar_url": u.avatar_url} for u in users]

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
    bracket_style: str = "strongVsStrong"
    is_live: bool = False
    invite_usernames: list = []   # usernames to invite when going live


def bracket_to_dict(b: Bracket, include_invites: bool = False):
    d = {
        "id": b.id,
        "name": b.name,
        "mode": b.mode,
        "players": b.players,
        "entries": b.entries,
        "bracket_data": b.bracket_data,
        "round_winners": b.round_winners or {},
        "bracket_style": b.bracket_style or "strongVsStrong",
        "is_live": b.is_live,
        "winner": b.winner,
        "host": b.owner.username,
        "host_avatar": b.owner.avatar_url,
        "created_at": b.created_at.isoformat(),
    }
    if include_invites:
        d["invites"] = [
            {"id": i.id, "invitee": i.invitee.username, "status": i.status}
            for i in b.invites
        ]
    return d


@app.get("/brackets")
def list_brackets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    brackets = (
        db.query(Bracket)
        .filter(Bracket.user_id == current_user.id)
        .order_by(Bracket.created_at.desc())
        .all()
    )
    return [{"id": b.id, "name": b.name, "mode": b.mode, "is_live": b.is_live, "winner": b.winner, "created_at": b.created_at.isoformat()} for b in brackets]


@app.post("/brackets")
def create_bracket(req: BracketCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bracket = Bracket(
        user_id=current_user.id,
        name=req.name,
        mode=req.mode,
        players=req.players,
        entries=req.entries,
        bracket_data=req.bracket_data,
        round_winners={},
        bracket_style=req.bracket_style,
        is_live=req.is_live,
    )
    db.add(bracket)
    db.commit()
    db.refresh(bracket)

    # Send invites if going live
    for username in req.invite_usernames:
        invitee = db.query(User).filter(User.username == username).first()
        if invitee and invitee.id != current_user.id:
            invite = TournamentInvite(bracket_id=bracket.id, inviter_id=current_user.id, invitee_id=invitee.id)
            db.add(invite)
    db.commit()

    return {"id": bracket.id, "name": bracket.name}


@app.get("/brackets/live")
def list_live_brackets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Brackets the current user is invited to and accepted, that are live."""
    invites = (
        db.query(TournamentInvite)
        .filter(TournamentInvite.invitee_id == current_user.id, TournamentInvite.status == "accepted")
        .all()
    )
    result = []
    for inv in invites:
        b = inv.bracket
        if b and b.is_live:
            result.append({"id": b.id, "name": b.name, "host": b.owner.username, "created_at": b.created_at.isoformat()})
    return result


@app.get("/brackets/{bracket_id}")
def get_bracket(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get full bracket state. Host or accepted invitee can view."""
    b = db.query(Bracket).filter(Bracket.id == bracket_id).first()
    if not b:
        raise HTTPException(status_code=404, detail="Bracket not found")
    # Check access: owner, or accepted invite
    is_owner = b.user_id == current_user.id
    is_invited = db.query(TournamentInvite).filter(
        TournamentInvite.bracket_id == bracket_id,
        TournamentInvite.invitee_id == current_user.id,
        TournamentInvite.status == "accepted"
    ).first()
    if not is_owner and not is_invited:
        raise HTTPException(status_code=403, detail="Not authorized")
    return bracket_to_dict(b, include_invites=is_owner)


class WinnerUpdate(BaseModel):
    key: str    # e.g. "r0_m3"
    winner: str # entry label


@app.patch("/brackets/{bracket_id}/winner")
def set_bracket_winner(bracket_id: int, req: WinnerUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Host records a match result. Updates round_winners in DB."""
    b = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id).first()
    if not b:
        raise HTTPException(status_code=403, detail="Only the host can record results")
    rw = dict(b.round_winners or {})
    rw[req.key] = req.winner
    b.round_winners = rw
    db.commit()
    return {"ok": True}


@app.patch("/brackets/{bracket_id}/end")
def end_tournament(bracket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Host ends the tournament."""
    b = db.query(Bracket).filter(Bracket.id == bracket_id, Bracket.user_id == current_user.id).first()
    if not b:
        raise HTTPException(status_code=403, detail="Only the host can end")
    b.is_live = False
    db.commit()
    return {"ok": True}


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


@app.get("/characters/stats/leaderboard")
def character_leaderboard(db: Session = Depends(get_db)):
    """Flat leaderboard: all user+character combos ranked by points."""
    rows = db.query(CharacterStats).filter(CharacterStats.points > 0).order_by(CharacterStats.points.desc()).all()
    return [
        {
            "username": row.owner.username,
            "avatar_url": row.owner.avatar_url,
            "character": row.character,
            "points": row.points,
        }
        for row in rows
    ]


@app.get("/characters/stats/{username}")
def get_stats_by_user(username: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    rows = db.query(CharacterStats).filter(CharacterStats.user_id == user.id).all()
    return {"username": user.username, "stats": [{"character": r.character, "points": r.points} for r in rows]}


class BulkStatEntry(BaseModel):
    character: str
    wins: int
    losses: int

class BulkStatsRequest(BaseModel):
    username: str
    entries: list[BulkStatEntry]

@app.post("/characters/stats/bulk")
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
            row = CharacterStats(user_id=target.id, character=entry.character, points=0)
            db.add(row)
        row.points = max(0, row.points + entry.wins - entry.losses)
    db.commit()
    return {"ok": True}

class StatRecordFor(BaseModel):
    username: str
    character: str
    result: str  # "win" or "loss"

@app.post("/characters/stats/record-for")
def record_stat_for(req: StatRecordFor, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Record a win/loss for any user (for quick match entry)."""
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
        row = CharacterStats(user_id=target.id, character=req.character, points=0)
        db.add(row)
    if req.result == "win":
        row.points += 1
    else:
        row.points = max(0, row.points - 1)
    db.commit()
    return {"character": row.character, "points": row.points}

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


# ── Match results (H2H + activity feed) ──────────────────────────────────────

class MatchRecord(BaseModel):
    winner_username: str
    winner_char: str
    loser_username: str
    loser_char: str
    bracket_id: int | None = None


def _update_char_stat(db: Session, user_id: int, character: str, result: str):
    row = db.query(CharacterStats).filter_by(user_id=user_id, character=character).first()
    if row is None:
        row = CharacterStats(user_id=user_id, character=character, points=0)
        db.add(row)
    if result == "win":
        row.points += 1
    else:
        row.points = max(0, row.points - 1)


@app.post("/matches/record")
def record_match(req: MatchRecord, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Record a completed match: updates char stats + logs match history."""
    winner = db.query(User).filter(User.username == req.winner_username).first()
    loser  = db.query(User).filter(User.username == req.loser_username).first()
    if not winner or not loser:
        raise HTTPException(status_code=400, detail="Unknown username")
    _update_char_stat(db, winner.id, req.winner_char, "win")
    _update_char_stat(db, loser.id,  req.loser_char,  "loss")
    mr = MatchResult(
        winner_id=winner.id, winner_char=req.winner_char,
        loser_id=loser.id,   loser_char=req.loser_char,
        bracket_id=req.bracket_id,
    )
    db.add(mr)
    db.commit()
    return {"ok": True}


@app.get("/users/{username}/h2h/{other}")
def h2h(username: str, other: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    u1 = db.query(User).filter(User.username == username).first()
    u2 = db.query(User).filter(User.username == other).first()
    if not u1 or not u2:
        raise HTTPException(status_code=404, detail="User not found")

    # Matches where u1 beat u2
    wins_as_winner = db.query(MatchResult).filter(
        MatchResult.winner_id == u1.id, MatchResult.loser_id == u2.id
    ).all()
    # Matches where u2 beat u1
    wins_as_loser = db.query(MatchResult).filter(
        MatchResult.winner_id == u2.id, MatchResult.loser_id == u1.id
    ).all()

    # Per-character breakdown from u1's perspective
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
        "chars": chars,   # {charName: {wins, losses}}
    }


@app.get("/users/{username}/activity")
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


# ── Profile comments ──────────────────────────────────────────────────────────

class CommentCreate(BaseModel):
    content: str


@app.get("/users/{username}/comments")
def get_comments(username: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    comments = db.query(ProfileComment).filter(ProfileComment.target_id == user.id)\
        .order_by(ProfileComment.created_at.desc()).limit(50).all()
    return [{"id": c.id, "author": c.author.username, "author_avatar": c.author.avatar_url,
             "content": c.content, "created_at": c.created_at.isoformat()} for c in comments]


@app.post("/users/{username}/comments")
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


@app.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    comment = db.query(ProfileComment).filter(ProfileComment.id == comment_id).first()
    if not comment:
        raise HTTPException(status_code=404, detail="Not found")
    if comment.author_id != current_user.id and comment.target_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    db.delete(comment)
    db.commit()
    return {"ok": True}


# ── Badges ────────────────────────────────────────────────────────────────────

@app.get("/users/{username}/badges")
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


# ── User profile ──────────────────────────────────────────────────────────────

class AvatarUpdate(BaseModel):
    avatar_url: str


@app.get("/users/me")
def get_me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.last_seen = datetime.utcnow()
    db.commit()
    return {"id": current_user.id, "username": current_user.username, "avatar_url": current_user.avatar_url}


@app.put("/users/me/avatar")
def update_avatar(req: AvatarUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    current_user.avatar_url = req.avatar_url or None
    db.commit()
    return {"ok": True}


# ── Friends ───────────────────────────────────────────────────────────────────

def _is_active(last_seen) -> bool:
    """Active = seen in the last 10 minutes."""
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


@app.get("/friends")
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


@app.get("/friends/requests")
def list_requests(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Friendship).filter(
        Friendship.addressee_id == current_user.id,
        Friendship.status == "pending",
    ).all()
    return [{"id": r.id, "username": r.requester.username, "avatar_url": r.requester.avatar_url} for r in rows]


@app.post("/friends/request")
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


@app.post("/friends/accept/{request_id}")
def accept_request(request_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(Friendship).filter(
        Friendship.id == request_id, Friendship.addressee_id == current_user.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    row.status = "accepted"
    db.commit()
    return {"ok": True}


@app.delete("/friends/request/{request_id}")
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


@app.delete("/friends/{user_id}")
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


# ── Serve frontend (must be last) ─────────────────────────────────────────────
@app.get("/")
def root():
    return FileResponse(os.path.join(WEB_DIR, "login.html"))

app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="frontend")
