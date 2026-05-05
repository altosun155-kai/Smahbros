import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
import os
import logging

from database import engine, Base, SessionLocal, Bracket, TournamentInvite
from auth import decode_token
from routers import auth, users, brackets, characters, matches, roundrobin, invites, friends, leaderboard, practice, presets
from routers.brackets import bracket_to_dict
import ws_manager
import game_ws_manager

logger = logging.getLogger(__name__)



def _run_migrations():
    is_pg = not str(engine.url).startswith("sqlite")
    with engine.connect() as conn:
        if is_pg:
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS round_winners JSONB DEFAULT '{}'"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS round_scores JSONB DEFAULT '{}'"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS bracket_style VARCHAR DEFAULT 'strongVsStrong'"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT FALSE"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS winner VARCHAR"))
            conn.execute(text("ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS kills INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS deaths INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS wins INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS losses INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS elo INTEGER DEFAULT 1000"))
            conn.execute(text("ALTER TABLE match_results ADD COLUMN IF NOT EXISTS winner_kills INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE match_results ADD COLUMN IF NOT EXISTS loser_kills INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE match_results ADD COLUMN IF NOT EXISTS match_key VARCHAR"))
            conn.execute(text("ALTER TABLE match_results ADD COLUMN IF NOT EXISTS elo_delta INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS chars_per_player INTEGER DEFAULT 2"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS confirmed_lineups JSONB DEFAULT '{}'"))
            conn.execute(text("ALTER TABLE tournament_presets ADD COLUMN IF NOT EXISTS pool_mode VARCHAR DEFAULT 'slot'"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS featured_badge VARCHAR"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS elo INTEGER DEFAULT 1000"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS teams JSONB DEFAULT NULL"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS placements JSONB DEFAULT NULL"))
            conn.execute(text("ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS sacrifices INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE NOT NULL"))
            conn.execute(text("UPDATE users SET is_admin = TRUE WHERE username = 'kai'"))
            # Indexes for hot query paths
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_winner_id  ON match_results(winner_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_loser_id   ON match_results(loser_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_bracket_id ON match_results(bracket_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_created_at ON match_results(created_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cs_user_id    ON character_stats(user_id)"))
            # Unique constraints (wrapped — fail gracefully if duplicates exist)
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_user_char ON character_stats(user_id, character)"))
            except Exception:
                pass
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_pair ON friendships(requester_id, addressee_id)"))
            except Exception:
                pass
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS practice_sessions (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    my_char VARCHAR NOT NULL,
                    cpu_char VARCHAR NOT NULL,
                    cpu_level INTEGER DEFAULT 9,
                    my_stocks INTEGER DEFAULT 3,
                    cpu_stocks INTEGER DEFAULT 0,
                    won BOOLEAN DEFAULT TRUE,
                    notes VARCHAR(500),
                    elo_delta INTEGER DEFAULT 0,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("ALTER TABLE practice_sessions ADD COLUMN IF NOT EXISTS elo_delta INTEGER DEFAULT 0"))
            conn.execute(text("ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS practice_elo INTEGER DEFAULT NULL"))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS character_matchups (
                    id SERIAL PRIMARY KEY,
                    char_a VARCHAR NOT NULL,
                    char_b VARCHAR NOT NULL,
                    wins_a INTEGER NOT NULL DEFAULT 0,
                    wins_b INTEGER NOT NULL DEFAULT 0,
                    UNIQUE(char_a, char_b)
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS character_skins (
                    id SERIAL PRIMARY KEY,
                    owner_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    skins JSONB DEFAULT '{}',
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS tournament_presets (
                    id SERIAL PRIMARY KEY,
                    creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    name VARCHAR NOT NULL,
                    players JSONB DEFAULT '[]',
                    fill_mode VARCHAR DEFAULT 'elo',
                    seed_mode VARCHAR DEFAULT 'elo',
                    bracket_style VARCHAR DEFAULT 'strongVsStrong',
                    chars_per_player INTEGER DEFAULT 2,
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
        else:
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(brackets)"))}
            if "round_winners" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN round_winners TEXT DEFAULT '{}'"))
            if "round_scores" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN round_scores TEXT DEFAULT '{}'"))
            if "bracket_style" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN bracket_style VARCHAR DEFAULT 'strongVsStrong'"))
            if "is_live" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN is_live BOOLEAN DEFAULT 0"))
            if "winner" not in cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN winner VARCHAR"))
            cs_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(character_stats)"))}
            if "kills" not in cs_cols:
                conn.execute(text("ALTER TABLE character_stats ADD COLUMN kills INTEGER DEFAULT 0"))
            if "deaths" not in cs_cols:
                conn.execute(text("ALTER TABLE character_stats ADD COLUMN deaths INTEGER DEFAULT 0"))
            if "wins" not in cs_cols:
                conn.execute(text("ALTER TABLE character_stats ADD COLUMN wins INTEGER DEFAULT 0"))
            if "losses" not in cs_cols:
                conn.execute(text("ALTER TABLE character_stats ADD COLUMN losses INTEGER DEFAULT 0"))
            if "elo" not in cs_cols:
                conn.execute(text("ALTER TABLE character_stats ADD COLUMN elo INTEGER DEFAULT 1000"))
            mr_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(match_results)"))}
            if "winner_kills" not in mr_cols:
                conn.execute(text("ALTER TABLE match_results ADD COLUMN winner_kills INTEGER DEFAULT 0"))
            if "loser_kills" not in mr_cols:
                conn.execute(text("ALTER TABLE match_results ADD COLUMN loser_kills INTEGER DEFAULT 0"))
            if "match_key" not in mr_cols:
                conn.execute(text("ALTER TABLE match_results ADD COLUMN match_key VARCHAR"))
            if "elo_delta" not in mr_cols:
                conn.execute(text("ALTER TABLE match_results ADD COLUMN elo_delta INTEGER DEFAULT 0"))
            b_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(brackets)"))}
            if "chars_per_player" not in b_cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN chars_per_player INTEGER DEFAULT 2"))
            if "confirmed_lineups" not in b_cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN confirmed_lineups TEXT DEFAULT '{}'"))
            if "teams" not in b_cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN teams TEXT DEFAULT NULL"))
            if "placements" not in b_cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN placements TEXT DEFAULT NULL"))
            try:
                tp_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(tournament_presets)"))}
                if "pool_mode" not in tp_cols:
                    conn.execute(text("ALTER TABLE tournament_presets ADD COLUMN pool_mode VARCHAR DEFAULT 'slot'"))
            except Exception:
                pass
            u_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}
            if "featured_badge" not in u_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN featured_badge VARCHAR"))
            if "is_admin" not in u_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0"))
            if "elo" not in u_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN elo INTEGER DEFAULT 1000"))
            conn.execute(text("UPDATE users SET is_admin = 1 WHERE username = 'kai'"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_winner_id  ON match_results(winner_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_loser_id   ON match_results(loser_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_bracket_id ON match_results(bracket_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_created_at ON match_results(created_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cs_user_id    ON character_stats(user_id)"))
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_user_char ON character_stats(user_id, character)"))
            except Exception:
                pass
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_friendship_pair ON friendships(requester_id, addressee_id)"))
            except Exception:
                pass
            ps_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(practice_sessions)"))}
            if "elo_delta" not in ps_cols:
                conn.execute(text("ALTER TABLE practice_sessions ADD COLUMN elo_delta INTEGER DEFAULT 0"))
            cs_cols2 = {row[1] for row in conn.execute(text("PRAGMA table_info(character_stats)"))}
            if "practice_elo" not in cs_cols2:
                conn.execute(text("ALTER TABLE character_stats ADD COLUMN practice_elo INTEGER DEFAULT NULL"))
            existing = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
            if "character_matchups" not in existing:
                conn.execute(text("""
                    CREATE TABLE character_matchups (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        char_a VARCHAR NOT NULL,
                        char_b VARCHAR NOT NULL,
                        wins_a INTEGER NOT NULL DEFAULT 0,
                        wins_b INTEGER NOT NULL DEFAULT 0,
                        UNIQUE(char_a, char_b)
                    )
                """))
            if "tournament_presets" not in existing:
                conn.execute(text("""
                    CREATE TABLE tournament_presets (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        name VARCHAR NOT NULL,
                        players TEXT DEFAULT '[]',
                        fill_mode VARCHAR DEFAULT 'elo',
                        seed_mode VARCHAR DEFAULT 'elo',
                        bracket_style VARCHAR DEFAULT 'strongVsStrong',
                        chars_per_player INTEGER DEFAULT 2,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
        conn.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: Base.metadata.create_all(bind=engine))
    await loop.run_in_executor(None, _run_migrations)
    ws_manager.set_loop(loop)
    yield


app = FastAPI(title="Smash Bracket API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


_DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception("Unhandled error: %s", exc)
    detail = f"{type(exc).__name__}: {exc}" if _DEBUG else "An unexpected error occurred"
    return JSONResponse(status_code=500, content={"detail": detail})


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(brackets.router)
app.include_router(characters.router)
app.include_router(matches.router)
app.include_router(roundrobin.router)
app.include_router(invites.router)
app.include_router(friends.router)
app.include_router(leaderboard.router)
app.include_router(practice.router)
app.include_router(presets.router)


@app.websocket("/ws/tournament/{tournament_id}")
async def ws_tournament(tournament_id: int, websocket: WebSocket):
    await websocket.accept()
    try:
        token = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
    except asyncio.TimeoutError:
        await websocket.close(code=1008)
        return
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=1008)
        return

    db = SessionLocal()
    try:
        b = db.query(Bracket).filter(Bracket.id == tournament_id).first()
        if not b:
            await websocket.close(code=1008)
            return
        is_owner = b.user_id == user_id
        invite = db.query(TournamentInvite).filter_by(
            bracket_id=tournament_id, invitee_id=user_id
        ).first()
        if not is_owner and not invite:
            await websocket.close(code=1008)
            return
        initial = bracket_to_dict(b)
    finally:
        db.close()

    await ws_manager.connect(tournament_id, websocket)
    try:
        await websocket.send_json(initial)
        while True:
            await websocket.receive_text()  # drain client pings; server pushes via broadcast
    except WebSocketDisconnect:
        ws_manager.disconnect(tournament_id, websocket)


@app.websocket("/ws/game/{room_id}")
async def ws_game(room_id: str, websocket: WebSocket):
    await websocket.accept()

    try:
        msg = await asyncio.wait_for(websocket.receive_json(), timeout=5.0)
    except Exception:
        await websocket.close(code=1008)
        return

    token    = msg.get("token", "")
    username = msg.get("username", "Player")
    user_id  = decode_token(token)
    if not user_id:
        await websocket.close(code=1008)
        return

    result = game_ws_manager.join_room(room_id, username, websocket)
    if result is None:
        await websocket.send_json({"type": "error", "message": "Room is full"})
        await websocket.close(code=1008)
        return

    room, slot = result
    await websocket.send_json({"type": "joined", "slot": slot, "room_id": room_id})
    await game_ws_manager.broadcast(room, {"type": "player_joined", "slot": slot, "username": username})

    active = sum(1 for p in room.players if p is not None)
    if active == 2:
        game_ws_manager.start_game(room)
        await game_ws_manager.broadcast(room, {"type": "start"})

    try:
        while True:
            data = await websocket.receive_json()
            game_ws_manager.handle_message(room, slot, data)
    except WebSocketDisconnect:
        game_ws_manager.leave_room(room_id, slot)
        await game_ws_manager.broadcast(room, {"type": "player_left", "slot": slot})


@app.get("/health")
def health():
    return {"ok": True}


# Serve the web/ frontend — must be last
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


@app.get("/")
def root():
    return FileResponse(os.path.join(WEB_DIR, "login.html"))


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="frontend")
