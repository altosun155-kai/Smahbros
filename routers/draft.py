from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from database import User, DraftRoom, DraftPick, Bracket, _now
from auth import get_db, get_current_user
import ws_manager

router = APIRouter(tags=["draft"])

VALID_CHARS_PER_PLAYER = (1, 4, 8)


class DraftRoomCreate(BaseModel):
    chars_per_player: int = 1


class PickUpdate(BaseModel):
    slot_index: int
    character: str


class SlotRequest(BaseModel):
    slot_index: int


def _push(db: Session, room: DraftRoom):
    ws_manager.push(f"draft:{room.id}", draft_room_to_dict(db, room, viewer_id=None))


def _pair_players_join_order(usernames: list) -> list:
    """Pair players in join order: [0]v[1], [2]v[3], ... A lone trailing player gets
    a bye (None). Deliberate scope simplification: no elo-based seeding for
    draft-originated brackets -- bracket-engine.js's buildBracketPairs() seeding
    logic is client-side JS and isn't reusable from this Python backend."""
    pairs = []
    for i in range(0, len(usernames), 2):
        a = usernames[i]
        b = usernames[i + 1] if i + 1 < len(usernames) else None
        pairs.append((a, b))
    return pairs


def _build_slot_bracket(pairs: list, picks_by_username: dict):
    """Return (bracket_data, entries, round_winners) for one draft slot's Bracket
    row. Matches tournament.html's own BYE convention exactly (bare 'BYE' label,
    not the 'SYSTEM — BYE' form bracket-engine.js uses for its own client-only
    entries list) since tournament.html is the page these brackets are viewed
    through. A bye pair's winner is pre-resolved into round_winners at creation
    time -- tournament.html has no auto-bye-advance of its own (confirmed by
    reading it: PATCH /brackets/{id}/winner is only ever called from a human
    recording a real match), so leaving it unresolved would strand the bracket."""
    bracket_data, entries, round_winners = [], [], {}
    for mi, (a_user, b_user) in enumerate(pairs):
        a_label = "BYE" if a_user is None else f"{a_user} — {picks_by_username[a_user]}"
        b_label = "BYE" if b_user is None else f"{b_user} — {picks_by_username[b_user]}"
        bracket_data.append({"a": a_label, "b": b_label})
        if a_user is not None:
            entries.append({"player": a_user, "character": picks_by_username[a_user]})
        if b_user is not None:
            entries.append({"player": b_user, "character": picks_by_username[b_user]})
        if a_user is None and b_user is not None:
            round_winners[f"r0_m{mi}"] = b_label
        elif b_user is None and a_user is not None:
            round_winners[f"r0_m{mi}"] = a_label
    return bracket_data, entries, round_winners


def _create_draft_brackets_and_go_live(db: Session, room: DraftRoom, pick_rows: list):
    """Creates room.chars_per_player independent live Bracket rows (round-1 paired
    in join order) and flips room.status straight to 'live' with bracket_ids
    populated -- all before the caller's single commit, so no client ever observes
    a separately-broadcast 'revealed' state."""
    players = room.players or []
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(players)).all()}
    usernames = [users_by_id[pid].username for pid in players if pid in users_by_id]
    pairs = _pair_players_join_order(usernames)

    picks_by_slot: dict = {}
    for p in pick_rows:
        picks_by_slot.setdefault(p.slot_index, {})[p.player_id] = p.character

    bracket_ids = []
    for slot in range(room.chars_per_player):
        picks_by_username = {
            users_by_id[pid].username: char
            for pid, char in picks_by_slot.get(slot, {}).items()
            if pid in users_by_id
        }
        bracket_data, entries, round_winners = _build_slot_bracket(pairs, picks_by_username)
        name = f"Draft #{room.id}" + (f" — Slot {slot + 1}" if room.chars_per_player > 1 else "")
        bracket = Bracket(
            user_id=room.host_id,
            name=name,
            mode="draft",
            players=usernames,
            entries=entries,
            bracket_data=bracket_data,
            round_winners=round_winners,
            is_live=True,
            chars_per_player=1,
        )
        db.add(bracket)
        db.flush()
        bracket_ids.append(bracket.id)

    room.bracket_ids = bracket_ids
    flag_modified(room, "bracket_ids")
    room.status = "live"


def draft_room_to_dict(db: Session, room: DraftRoom, viewer_id: int | None = None) -> dict:
    player_ids = room.players or []
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(player_ids)).all()}
    players_out = [
        {"id": pid, "username": users_by_id[pid].username, "avatar_url": users_by_id[pid].avatar_url}
        for pid in player_ids if pid in users_by_id
    ]

    picks_by_player = {
        str(pid): [{"slot_index": i, "locked": False, "character": None} for i in range(room.chars_per_player)]
        for pid in player_ids
    }
    rows = db.query(DraftPick).filter(DraftPick.room_id == room.id).all()
    for p in rows:
        key = str(p.player_id)
        if key not in picks_by_player or p.slot_index >= room.chars_per_player:
            continue
        reveal = (p.player_id == viewer_id) or room.status in ("revealed", "live")
        picks_by_player[key][p.slot_index] = {
            "slot_index": p.slot_index,
            "locked": p.locked_at is not None,
            "character": p.character if reveal else None,
        }

    return {
        "id": room.id,
        "status": room.status,
        "host_id": room.host_id,
        "num_players": room.num_players,
        "chars_per_player": room.chars_per_player,
        "players": players_out,
        "picks": picks_by_player,
        "bracket_id": room.bracket_id,
        "bracket_ids": room.bracket_ids or [],
        "created_at": room.created_at.isoformat(),
    }


@router.post("/draft/rooms")
def create_draft_room(req: DraftRoomCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.chars_per_player not in VALID_CHARS_PER_PLAYER:
        raise HTTPException(status_code=400, detail="chars_per_player must be 1, 4, or 8")
    room = DraftRoom(
        host_id=current_user.id,
        status="lobby",
        chars_per_player=req.chars_per_player,
        players=[current_user.id],
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    return {"id": room.id}


@router.get("/draft/rooms/active")
def list_active_draft_rooms(db: Session = Depends(get_db), _cu: User = Depends(get_current_user)):
    cutoff = _now() - timedelta(hours=6)
    rooms = (
        db.query(DraftRoom)
        .filter(DraftRoom.status == "lobby", DraftRoom.created_at > cutoff)
        .order_by(DraftRoom.created_at.desc())
        .all()
    )
    out = []
    for r in rooms:
        players = r.players or []
        if len(players) >= r.num_players:
            continue
        out.append({
            "id": r.id,
            "host_username": r.host.username,
            "player_count": len(players),
            "num_players": r.num_players,
        })
    return out


@router.get("/draft/rooms/{room_id}")
def get_draft_room(room_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Draft room not found")
    if current_user.id not in (room.players or []):
        raise HTTPException(status_code=403, detail="Not a member of this draft room")
    return draft_room_to_dict(db, room, viewer_id=current_user.id)


@router.post("/draft/rooms/{room_id}/join")
def join_draft_room(room_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Draft room not found")
    players = room.players or []
    if current_user.id not in players:
        if room.status != "lobby" or len(players) >= room.num_players:
            raise HTTPException(status_code=403, detail="This draft room can't be joined")
        players.append(current_user.id)
        room.players = players
        flag_modified(room, "players")
        db.commit()
        db.refresh(room)
        _push(db, room)
    return draft_room_to_dict(db, room, viewer_id=current_user.id)


@router.post("/draft/rooms/{room_id}/start")
def start_draft_room(room_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id, DraftRoom.host_id == current_user.id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Draft room not found")
    if room.status != "lobby":
        raise HTTPException(status_code=400, detail="Draft room already started")
    if len(room.players or []) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 players to start")
    room.status = "picking"
    db.commit()

    other_lobbies = db.query(DraftRoom).filter(
        DraftRoom.host_id == current_user.id,
        DraftRoom.status == "lobby",
        DraftRoom.id != room.id,
    ).all()
    for r in other_lobbies:
        r.status = "closed"
    db.commit()

    db.refresh(room)
    _push(db, room)
    return draft_room_to_dict(db, room, viewer_id=current_user.id)


@router.post("/draft/rooms/{room_id}/close")
def close_draft_room(room_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id, DraftRoom.host_id == current_user.id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Draft room not found")
    if room.status != "lobby":
        raise HTTPException(status_code=400, detail="Only a lobby-status room can be closed")
    room.status = "closed"
    db.commit()
    db.refresh(room)
    _push(db, room)
    return {"ok": True}


@router.put("/draft/rooms/{room_id}/pick")
def pick_draft_character(room_id: int, req: PickUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Draft room not found")
    if room.status != "picking":
        raise HTTPException(status_code=400, detail="Draft room is not in the picking phase")
    if current_user.id not in (room.players or []):
        raise HTTPException(status_code=403, detail="Not a member of this draft room")
    if not (0 <= req.slot_index < room.chars_per_player):
        raise HTTPException(status_code=400, detail="Invalid slot_index")

    pick = db.query(DraftPick).filter(
        DraftPick.room_id == room_id,
        DraftPick.player_id == current_user.id,
        DraftPick.slot_index == req.slot_index,
    ).first()
    if pick and pick.locked_at is not None:
        raise HTTPException(status_code=400, detail="Slot is already locked")
    if pick:
        pick.character = req.character
    else:
        pick = DraftPick(room_id=room_id, player_id=current_user.id, slot_index=req.slot_index, character=req.character)
        db.add(pick)
    db.commit()
    db.refresh(room)
    _push(db, room)
    return draft_room_to_dict(db, room, viewer_id=current_user.id)


@router.post("/draft/rooms/{room_id}/unlock")
def unlock_draft_pick(room_id: int, req: SlotRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Draft room not found")
    if room.status != "picking":
        raise HTTPException(status_code=400, detail="Draft room is not in the picking phase")
    pick = db.query(DraftPick).filter(
        DraftPick.room_id == room_id,
        DraftPick.player_id == current_user.id,
        DraftPick.slot_index == req.slot_index,
    ).first()
    if not pick or pick.locked_at is None:
        raise HTTPException(status_code=400, detail="Slot is not locked")
    pick.locked_at = None
    db.commit()
    db.refresh(room)
    _push(db, room)
    return draft_room_to_dict(db, room, viewer_id=current_user.id)


@router.post("/draft/rooms/{room_id}/lock")
def lock_draft_pick(room_id: int, req: SlotRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id).first()
    if not room:
        raise HTTPException(status_code=404, detail="Draft room not found")
    if room.status != "picking":
        raise HTTPException(status_code=400, detail="Draft room is not in the picking phase")
    pick = db.query(DraftPick).filter(
        DraftPick.room_id == room_id,
        DraftPick.player_id == current_user.id,
        DraftPick.slot_index == req.slot_index,
    ).first()
    if not pick or not pick.character:
        raise HTTPException(status_code=400, detail="No character picked for this slot yet")
    if pick.locked_at is not None:
        raise HTTPException(status_code=400, detail="Slot is already locked")
    pick.locked_at = _now()
    db.commit()

    # Re-fetch with a row lock before deciding whether the whole room is now fully
    # locked, so two concurrent lock calls for the last two slots can't both observe
    # "everyone's locked" and both flip status / push a "revealed" broadcast.
    room = db.query(DraftRoom).filter(DraftRoom.id == room_id).with_for_update().first()
    if room.status == "picking":
        players = room.players or []
        all_rows = db.query(DraftPick).filter(DraftPick.room_id == room_id).all()
        locked_by_player: dict = {}
        for row in all_rows:
            if row.locked_at is not None:
                locked_by_player.setdefault(row.player_id, set()).add(row.slot_index)
        everyone_locked = all(
            len(locked_by_player.get(pid, set())) >= room.chars_per_player for pid in players
        )
        if everyone_locked and players:
            _create_draft_brackets_and_go_live(db, room, all_rows)
            db.commit()

    db.refresh(room)
    _push(db, room)
    return draft_room_to_dict(db, room, viewer_id=current_user.id)
