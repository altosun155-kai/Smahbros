from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy import text
import os
import logging

from database import engine, Base
from routers import auth, users, brackets, characters, matches, roundrobin, invites, friends, leaderboard, practice, presets

logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)


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
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS teams JSONB DEFAULT NULL"))
            conn.execute(text("ALTER TABLE brackets ADD COLUMN IF NOT EXISTS placements JSONB DEFAULT NULL"))
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
                    created_at TIMESTAMP DEFAULT NOW()
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
            try:
                tp_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(tournament_presets)"))}
                if "pool_mode" not in tp_cols:
                    conn.execute(text("ALTER TABLE tournament_presets ADD COLUMN pool_mode VARCHAR DEFAULT 'slot'"))
            except Exception:
                pass
            u_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(users)"))}
            if "featured_badge" not in u_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN featured_badge VARCHAR"))
            b2_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(brackets)"))}
            if "teams" not in b2_cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN teams TEXT DEFAULT NULL"))
            b3_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(brackets)"))}
            if "placements" not in b3_cols:
                conn.execute(text("ALTER TABLE brackets ADD COLUMN placements TEXT DEFAULT NULL"))
            existing = {row[0] for row in conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))}
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


_run_migrations()

app = FastAPI(title="Smash Bracket API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "An unexpected error occurred"})


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


@app.get("/health")
def health():
    return {"ok": True}


# Serve the web/ frontend — must be last
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")


@app.get("/")
def root():
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="frontend")
