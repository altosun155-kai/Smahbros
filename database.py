from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./smash.db")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    username        = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow)

    brackets          = relationship("Bracket", back_populates="owner", cascade="all, delete-orphan")
    rr_sessions       = relationship("RoundRobinResult", back_populates="owner", cascade="all, delete-orphan")
    character_ranking = relationship("CharacterRanking", back_populates="owner", uselist=False, cascade="all, delete-orphan")
    sent_invites        = relationship("TournamentInvite", foreign_keys="TournamentInvite.inviter_id", back_populates="inviter")
    received_invites    = relationship("TournamentInvite", foreign_keys="TournamentInvite.invitee_id", back_populates="invitee")
    favorite_characters = relationship("FavoriteCharacters", back_populates="owner", uselist=False, cascade="all, delete-orphan")
    character_stats     = relationship("CharacterStats", back_populates="owner", cascade="all, delete-orphan")


class Bracket(Base):
    __tablename__ = "brackets"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False)
    name         = Column(String, nullable=False)
    mode         = Column(String, default="regular")
    players      = Column(JSON, default=list)
    entries      = Column(JSON, default=list)
    bracket_data = Column(JSON, default=list)
    winner       = Column(String, nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow)

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
    with a floor of 0.
    """
    __tablename__ = "character_stats"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    character  = Column(String, nullable=False)
    points     = Column(Integer, default=0, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="character_stats")
