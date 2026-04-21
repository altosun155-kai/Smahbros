import random as _random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import (Bracket, CharacterStats, TournamentInvite,
                      TournamentPreset, User)
from auth import get_db, get_current_user

router = APIRouter(tags=["presets"])


class PresetCreate(BaseModel):
    name: str
    players: list[str]
    fill_mode: str = "elo"
    seed_mode: str = "elo"
    bracket_style: str = "strongVsStrong"
    chars_per_player: int = 2


def _preset_to_dict(p: TournamentPreset) -> dict:
    return {
        "id": p.id,
        "name": p.name,
        "creator": p.creator.username,
        "players": p.players,
        "fill_mode": p.fill_mode,
        "seed_mode": p.seed_mode,
        "bracket_style": p.bracket_style,
        "chars_per_player": p.chars_per_player,
        "created_at": p.created_at.isoformat(),
    }


def _top_chars(db: Session, user: User, fill_mode: str, n: int) -> list[str]:
    stats = db.query(CharacterStats).filter(CharacterStats.user_id == user.id).all()
    played = [s for s in stats if (s.wins or 0) + (s.losses or 0) > 0]
    if not played:
        return []

    if fill_mode == "kills":
        ranked = sorted(played, key=lambda s: s.kills or 0, reverse=True)
    elif fill_mode == "winpct":
        def _wpct(s):
            total = (s.wins or 0) + (s.losses or 0)
            return s.wins / total if total >= 3 else 0
        ranked = sorted(played, key=_wpct, reverse=True)
    else:  # elo (default), favorites, tierlist all fall back to elo server-side
        ranked = sorted(played, key=lambda s: s.elo or 1000, reverse=True)

    return [s.character for s in ranked[:n]]


def _seed_value(db: Session, user_id: int, character: str, mode: str) -> float:
    stat = db.query(CharacterStats).filter(
        CharacterStats.user_id == user_id,
        CharacterStats.character == character,
    ).first()
    if not stat:
        return 0.0
    if mode == "kills":
        return float(stat.kills or 0)
    if mode == "winpct":
        total = (stat.wins or 0) + (stat.losses or 0)
        return stat.wins / total if total >= 3 else 0.0
    return float(stat.elo or 1000)


def _build_bracket_data(entries: list[dict], style: str, seed_values: dict) -> list[dict]:
    """Seed entries, pad to power of 2, pair according to bracket_style."""
    if style == "random":
        seeded = entries[:]
        _random.shuffle(seeded)
    else:
        seeded = sorted(entries, key=lambda e: seed_values.get(f"{e['player']}:{e['character']}", 0), reverse=True)

    # Pad to next power of 2
    p2 = 1
    while p2 < len(seeded):
        p2 <<= 1
    seeded += [{"player": "BYE", "character": ""}] * (p2 - len(seeded))

    labels = [f"{e['player']} — {e['character']}" if e["character"] else "BYE" for e in seeded]

    if style == "strongVsWeak":
        pairs = [(labels[i], labels[len(labels) - 1 - i]) for i in range(len(labels) // 2)]
    else:  # strongVsStrong and random (already shuffled above)
        pairs = [(labels[i], labels[i + 1]) for i in range(0, len(labels), 2)]

    return [{"a": a, "b": b} for a, b in pairs]


@router.get("/presets")
def list_presets(db: Session = Depends(get_db), _cu: User = Depends(get_current_user)):
    presets = db.query(TournamentPreset).order_by(TournamentPreset.created_at.desc()).all()
    return [_preset_to_dict(p) for p in presets]


@router.post("/presets")
def create_preset(req: PresetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Name required")
    if len(req.players) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 players")
    preset = TournamentPreset(
        creator_id=current_user.id,
        name=req.name.strip(),
        players=req.players,
        fill_mode=req.fill_mode,
        seed_mode=req.seed_mode,
        bracket_style=req.bracket_style,
        chars_per_player=max(1, min(req.chars_per_player, 5)),
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return _preset_to_dict(preset)


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    preset = db.query(TournamentPreset).filter(
        TournamentPreset.id == preset_id,
        TournamentPreset.creator_id == current_user.id,
    ).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found or not yours")
    db.delete(preset)
    db.commit()
    return {"ok": True}


@router.post("/presets/{preset_id}/launch")
def launch_preset(preset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    preset = db.query(TournamentPreset).filter(TournamentPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    # Build entries and confirmed lineups
    entries: list[dict] = []
    confirmed_lineups: dict = {}
    seed_values: dict = {}

    for username in preset.players:
        user = db.query(User).filter(User.username == username).first()
        if not user:
            continue
        chars = _top_chars(db, user, preset.fill_mode, preset.chars_per_player)
        confirmed_lineups[username] = chars
        for char in chars:
            entries.append({"player": username, "character": char})
            seed_values[f"{username}:{char}"] = _seed_value(db, user.id, char, preset.seed_mode)

    bracket_data = _build_bracket_data(entries, preset.bracket_style, seed_values)

    bracket_name = f"{preset.name} — {datetime.utcnow().strftime('%b %d')}"
    bracket = Bracket(
        user_id=current_user.id,
        name=bracket_name,
        mode="regular",
        players=preset.players,
        entries=entries,
        bracket_data=bracket_data,
        round_winners={},
        bracket_style=preset.bracket_style,
        is_live=True,
        chars_per_player=preset.chars_per_player,
        confirmed_lineups=confirmed_lineups,
    )
    db.add(bracket)
    db.commit()
    db.refresh(bracket)

    # Auto-accept invites so all preset players can see it immediately
    for username in preset.players:
        if username == current_user.username:
            continue
        invitee = db.query(User).filter(User.username == username).first()
        if invitee:
            db.add(TournamentInvite(
                bracket_id=bracket.id,
                inviter_id=current_user.id,
                invitee_id=invitee.id,
                status="accepted",
            ))
    db.commit()

    return {"id": bracket.id, "name": bracket.name}
