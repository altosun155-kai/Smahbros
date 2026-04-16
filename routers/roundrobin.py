from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from database import User, RoundRobinResult
from auth import get_db, get_current_user

router = APIRouter(prefix="/roundrobin", tags=["roundrobin"])


class RRCreate(BaseModel):
    name: str
    players: list
    results: dict = {}
    records: dict = {}


@router.get("")
def list_rr(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    sessions = (
        db.query(RoundRobinResult)
        .filter(RoundRobinResult.user_id == current_user.id)
        .order_by(RoundRobinResult.created_at.desc())
        .all()
    )
    return [{"id": s.id, "name": s.name, "created_at": s.created_at.isoformat()} for s in sessions]


@router.get("/{rr_id}")
def get_rr(rr_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    s = db.query(RoundRobinResult).filter(
        RoundRobinResult.id == rr_id, RoundRobinResult.user_id == current_user.id
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"id": s.id, "name": s.name, "players": s.players, "results": s.results, "records": s.records}


@router.post("")
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
