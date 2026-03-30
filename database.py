from sqlalchemy import create_engine, Column, Integer, String, JSON, DateTime, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker, relationship
from datetime import datetime
import os

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./smash.db")

# Render gives Postgres URLs that start with "postgres://" — SQLAlchemy needs "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(
    DATABASE_URL,
    # SQLite only: remove connect_args when using Postgres
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    brackets = relationship("Bracket", back_populates="owner", cascade="all, delete-orphan")
    rr_sessions = relationship("RoundRobinResult", back_populates="owner", cascade="all, delete-orphan")


class Bracket(Base):
    __tablename__ = "brackets"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)          # user-given name, e.g. "Friday Night S3"
    mode = Column(String, default="regular")        # "regular" | "teams"
    players = Column(JSON, default=list)            # ["Alice", "Bob", ...]
    entries = Column(JSON, default=list)            # [{"player": ..., "character": ...}]
    bracket_data = Column(JSON, default=list)       # round-1 pairs as dicts
    winner = Column(String, nullable=True)          # winning player name, filled in later
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="brackets")


class RoundRobinResult(Base):
    __tablename__ = "roundrobin_results"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String, nullable=False)
    players = Column(JSON, default=list)
    results = Column(JSON, default=dict)    # match_id -> winner player name
    records = Column(JSON, default=dict)    # player -> {"Wins": N, "Losses": N}
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="rr_sessions")
