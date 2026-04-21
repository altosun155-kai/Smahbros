from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import Bracket, TournamentInvite, TournamentPreset, User
from auth import get_db, get_current_user

router = APIRouter(tags=["presets"])


class PresetCreate(BaseModel):
    name: str
    players: list[str]
    fill_mode: str = "elo"
    seed_mode: str = "elo"
    bracket_style: str = "strongVsStrong"
    chars_per_player: int = 2


class PresetUpdate(BaseModel):
    name: Optional[str] = None
    players: Optional[list[str]] = None
    fill_mode: Optional[str] = None
    seed_mode: Optional[str] = None
    bracket_style: Optional[str] = None
    chars_per_player: Optional[int] = None


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


@router.patch("/presets/{preset_id}")
def update_preset(preset_id: int, req: PresetUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    preset = db.query(TournamentPreset).filter(
        TournamentPreset.id == preset_id,
        TournamentPreset.creator_id == current_user.id,
    ).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found or not yours")
    if req.name is not None:
        if not req.name.strip():
            raise HTTPException(status_code=400, detail="Name required")
        preset.name = req.name.strip()
    if req.players is not None:
        if len(req.players) < 2:
            raise HTTPException(status_code=400, detail="Need at least 2 players")
        preset.players = req.players
    if req.fill_mode is not None:
        preset.fill_mode = req.fill_mode
    if req.seed_mode is not None:
        preset.seed_mode = req.seed_mode
    if req.bracket_style is not None:
        preset.bracket_style = req.bracket_style
    if req.chars_per_player is not None:
        preset.chars_per_player = max(1, min(req.chars_per_player, 5))
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


class PresetLaunch(BaseModel):
    exclude_players: list[str] = []


@router.post("/presets/{preset_id}/launch")
def launch_preset(preset_id: int, req: PresetLaunch = PresetLaunch(), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create a live bracket in lineup mode — players pick their own characters in tournament.html."""
    preset = db.query(TournamentPreset).filter(TournamentPreset.id == preset_id).first()
    if not preset:
        raise HTTPException(status_code=404, detail="Preset not found")

    excluded = set(req.exclude_players)
    players = [p for p in preset.players if p not in excluded]
    if len(players) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 players after exclusions")

    bracket_name = f"{preset.name} — {datetime.utcnow().strftime('%b %d')}"
    bracket_style_str = f"{preset.bracket_style}|{preset.seed_mode}"

    bracket = Bracket(
        user_id=current_user.id,
        name=bracket_name,
        mode="regular",
        players=players,
        entries=[],
        bracket_data=[],
        round_winners={},
        bracket_style=bracket_style_str,
        is_live=True,
        chars_per_player=preset.chars_per_player,
        confirmed_lineups={},
    )
    db.add(bracket)
    db.commit()
    db.refresh(bracket)

    for username in players:
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
