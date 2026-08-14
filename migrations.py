from sqlalchemy import text

from database import engine


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
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test BOOLEAN DEFAULT FALSE NOT NULL"))
            conn.execute(text("UPDATE users SET is_test = TRUE WHERE username ILIKE 'testuser%'"))
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
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS draft_rooms (
                    id SERIAL PRIMARY KEY,
                    host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    status VARCHAR NOT NULL DEFAULT 'lobby',
                    num_players INTEGER NOT NULL DEFAULT 4,
                    chars_per_player INTEGER NOT NULL DEFAULT 1,
                    players JSONB DEFAULT '[]',
                    bracket_id INTEGER REFERENCES brackets(id),
                    bracket_ids JSONB DEFAULT '[]',
                    created_at TIMESTAMP DEFAULT NOW()
                )
            """))
            conn.execute(text("ALTER TABLE draft_rooms ADD COLUMN IF NOT EXISTS bracket_ids JSONB DEFAULT '[]'"))
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS draft_picks (
                    id SERIAL PRIMARY KEY,
                    room_id INTEGER NOT NULL REFERENCES draft_rooms(id) ON DELETE CASCADE,
                    player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    slot_index INTEGER NOT NULL,
                    character VARCHAR,
                    locked_at TIMESTAMP,
                    UNIQUE(room_id, player_id, slot_index)
                )
            """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_dp_room_id ON draft_picks(room_id)"))
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
            if "is_test" not in u_cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_test BOOLEAN DEFAULT 0"))
            conn.execute(text("UPDATE users SET is_admin = 1 WHERE username = 'kai'"))
            conn.execute(text("UPDATE users SET is_test = 1 WHERE username LIKE 'testuser%'"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_winner_id  ON match_results(winner_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_loser_id   ON match_results(loser_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_bracket_id ON match_results(bracket_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_mr_created_at ON match_results(created_at)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_cs_user_id    ON character_stats(user_id)"))
            try:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_cs_user_char ON character_stats(user_id, character)"))
            except Exception:
                pass
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
            if "draft_rooms" not in existing:
                conn.execute(text("""
                    CREATE TABLE draft_rooms (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        host_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        status VARCHAR NOT NULL DEFAULT 'lobby',
                        num_players INTEGER NOT NULL DEFAULT 4,
                        chars_per_player INTEGER NOT NULL DEFAULT 1,
                        players TEXT DEFAULT '[]',
                        bracket_id INTEGER REFERENCES brackets(id),
                        bracket_ids TEXT DEFAULT '[]',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """))
            dr_cols = {row[1] for row in conn.execute(text("PRAGMA table_info(draft_rooms)"))}
            if "bracket_ids" not in dr_cols:
                conn.execute(text("ALTER TABLE draft_rooms ADD COLUMN bracket_ids TEXT DEFAULT '[]'"))
            if "draft_picks" not in existing:
                conn.execute(text("""
                    CREATE TABLE draft_picks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        room_id INTEGER NOT NULL REFERENCES draft_rooms(id) ON DELETE CASCADE,
                        player_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        slot_index INTEGER NOT NULL,
                        character VARCHAR,
                        locked_at TIMESTAMP,
                        UNIQUE(room_id, player_id, slot_index)
                    )
                """))
            conn.execute(text("CREATE INDEX IF NOT EXISTS idx_dp_room_id ON draft_picks(room_id)"))
        conn.commit()
