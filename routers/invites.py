from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import User, Bracket, TournamentInvite
from auth import get_db, get_current_user

router = APIRouter(prefix="/invites", tags=["invites"])


class InviteCreate(BaseModel):
    bracket_id: int
    invitee_username: str


class InviteUpdate(BaseModel):
    status: str


@router.get("/received")
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


@router.get("/sent")
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


@router.get("/bracket/{bracket_id}")
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


@router.post("")
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


@router.patch("/{invite_id}")
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


@router.delete("/{invite_id}")
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
