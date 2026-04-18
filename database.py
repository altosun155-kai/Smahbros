from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./smash.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,
        pool_recycle=300,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    username        = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    avatar_url      = Column(String, nullable=True)
    last_seen       = Column(DateTime, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    brackets          = relationship("Bracket", back_populates="owner", cascade="all, delete-orphan")
    rr_sessions       = relationship("RoundRobinResult", back_populates="owner", cascade="all, delete-orphan")
    character_ranking = relationship("CharacterRanking", back_populates="owner", uselist=False, cascade="all, delete-orphan")
    sent_invites        = relationship("TournamentInvite", foreign_keys="TournamentInvite.inviter_id", back_populates="inviter")
    received_invites    = relationship("TournamentInvite", foreign_keys="TournamentInvite.invitee_id", back_populates="invitee")
    favorite_characters = relationship("FavoriteCharacters", back_populates="owner", uselist=False, cascade="all, delete-orphan")
    character_stats     = relationship("CharacterStats", back_populates="owner", cascade="all, delete-orphan")
    sent_friend_requests     = relationship("Friendship", foreign_keys="Friendship.requester_id", back_populates="requester", cascade="all, delete-orphan")
    received_friend_requests = relationship("Friendship", foreign_keys="Friendship.addressee_id", back_populates="addressee", cascade="all, delete-orphan")


class Bracket(Base):
    __tablename__ = "brackets"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False)
    name         = Column(String, nullable=False)
    mode         = Column(String, default="regular")
    players      = Column(JSON, default=list)
    entries      = Column(JSON, default=list)
    bracket_data  = Column(JSON, default=list)
    round_winners      = Column(JSON, default=dict)   # {"r0_m0": "player — char", ...}
    round_scores       = Column(JSON, default=dict)   # {"r0_m0": "3-1", ...}
    bracket_style      = Column(String, default="strongVsStrong")
    is_live            = Column(Boolean, default=False)
    winner             = Column(String, nullable=True)
    chars_per_player   = Column(Integer, default=2)
    confirmed_lineups  = Column(JSON, default=dict)   # {username: ["char1", ...]}
    placements         = Column(JSON, nullable=True)  # {"1st": {"player":"kai","char":"Terry","elo_bonus":64}, "2nd": {...}, "3rd": [...]}
    created_at         = Column(DateTime, default=datetime.utcnow)

    owner   = relationship("User", back_populates="brackets")
    invites = relationship("TournamentInvite", back_populates="bracket", cascade="all, delete-orphan")


class RoundRobinResult(Base):
    __tablename__ = "roundrobin_results"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    name       = Column(String, nullable=False)
    players    = Column(JSON, default=list)
    results    = Column(JSON, default=dict)
    records    = Column(JSON, default=dict)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="rr_sessions")


class CharacterRanking(Base):
    """
    One row per user. Stores their full Smash Ultimate tier list.
    ranking = {
      "S": ["Mario", "Pikachu", ...],
      "A": [...], "B": [...], "C": [...], "D": [...], "F": [...],
      "unranked": [...]   <- all characters the user hasn't placed yet
    }
    """
    __tablename__ = "character_rankings"

    id         = Column(Integer, primary_key=True, index=True)
    owner_id   = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    ranking    = Column(JSON, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="character_ranking")


class TournamentInvite(Base):
    """
    Tracks per-bracket invites from one user to another.
    status: "pending" | "accepted" | "declined"
    """
    __tablename__ = "tournament_invites"

    id         = Column(Integer, primary_key=True, index=True)
    bracket_id = Column(Integer, ForeignKey("brackets.id"), nullable=False)
    inviter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    invitee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status     = Column(String, default="pending")   # pending | accepted | declined
    created_at = Column(DateTime, default=datetime.utcnow)

    bracket = relationship("Bracket", back_populates="invites")
    inviter = relationship("User", foreign_keys=[inviter_id], back_populates="sent_invites")
    invitee = relationship("User", foreign_keys=[invitee_id], back_populates="received_invites")


class FavoriteCharacters(Base):
    __tablename__ = "favorite_characters"

    id         = Column(Integer, primary_key=True, index=True)
    owner_id   = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    characters = Column(JSON, default=list)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="favorite_characters")


class CharacterStats(Base):
    """
    One row per (user, character). Points start at 0, +1 on win, -1 on loss
    with a floor of 0. Kills = stock kills (from match scores). Wins/losses
    are raw counts (never decremented) for win-percentage calculation.
    """
    __tablename__ = "character_stats"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    character  = Column(String, nullable=False)
    points     = Column(Integer, default=0, nullable=False)
    elo        = Column(Integer, default=1000, nullable=False)
    kills      = Column(Integer, default=0, nullable=False)
    deaths     = Column(Integer, default=0, nullable=False)
    wins       = Column(Integer, default=0, nullable=False)
    losses     = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="character_stats")


class Friendship(Base):
    """
    status: "pending" | "accepted"
    requester sends the request, addressee receives it.
    """
    __tablename__ = "friendships"

    id           = Column(Integer, primary_key=True, index=True)
    requester_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    addressee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status       = Column(String, default="pending")
    created_at   = Column(DateTime, default=datetime.utcnow)

    requester = relationship("User", foreign_keys=[requester_id], back_populates="sent_friend_requests")
    addressee = relationship("User", foreign_keys=[addressee_id], back_populates="received_friend_requests")


class MatchResult(Base):
    """
    One row per completed match. Recorded when a winner is selected
    in the bracket or Quick Match.
    """
    __tablename__ = "match_results"

    id           = Column(Integer, primary_key=True, index=True)
    winner_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    winner_char  = Column(String, nullable=False)
    winner_kills = Column(Integer, default=0, nullable=False)
    loser_id     = Column(Integer, ForeignKey("users.id"), nullable=False)
    loser_char   = Column(String, nullable=False)
    loser_kills  = Column(Integer, default=0, nullable=False)
    bracket_id   = Column(Integer, ForeignKey("brackets.id"), nullable=True)
    match_key    = Column(String, nullable=True)
    elo_delta    = Column(Integer, default=0, nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)

    winner  = relationship("User", foreign_keys=[winner_id])
    loser   = relationship("User", foreign_keys=[loser_id])


class ProfileComment(Base):
    """
    GG / comment left on a user's profile by another user.
    """
    __tablename__ = "profile_comments"

    id         = Column(Integer, primary_key=True, index=True)
    author_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    content    = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    author = relationship("User", foreign_keys=[author_id])
    target = relationship("User", foreign_keys=[target_id])
