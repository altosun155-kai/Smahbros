import random
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified
from pydantic import BaseModel

from database import User, DraftRoom, DraftPick, Bracket, CharacterStats, FavoriteCharacters, _now, to_utc_iso
from auth import get_db, get_current_user
import ws_manager

router = APIRouter(tags=["draft"])

VALID_CHARS_PER_PLAYER = (1, 4, 8)

# Sentinel "oldest possible" for _prefill_fill_order's recency sort -- a row
# should never actually have a null updated_at (default=_now on insert), but
# sorting a hypothetical null-timestamp row last rather than crashing is the
# safer failure mode for something that only ever affects fill order, never
# correctness of what's stored.
_EPOCH = datetime.min


def _next_power_of_two(n: int) -> int:
    p = 1
    while p < n:
        p *= 2
    return p


def _is_power_of_two(n: int) -> bool:
    return n > 0 and (n & (n - 1)) == 0


class DraftRoomCreate(BaseModel):
    chars_per_player: int = 1


class PickUpdate(BaseModel):
    slot_index: int
    # Optional, defaulting to None -- a request that omits it, sends null, or
    # sends "" all mean the same thing: clear this slot. Normalized to a true
    # None before it's ever compared or stored (see pick_draft_character), so
    # the DB never ends up with an empty-string character -- distinct from
    # None to every downstream reader (raw `character IS NOT NULL` filters,
    # a future consumer that doesn't already happen to treat "" as falsy the
    # way today's few callers do).
    character: Optional[str] = None
    # Optimistic-concurrency guard, optional and backward-compatible.
    # Presence -- not just a non-None value -- is what matters: a caller
    # that omits this field entirely gets today's exact behavior (no
    # check at all), while one that sends it (including explicitly as
    # null, meaning "I believe this slot is empty") gets it compared
    # against the slot's real stored value. "Omitted" and "sent as null"
    # both read as None on this field, so the endpoint can't tell them
    # apart from expected_character's value alone -- it checks
    # 'expected_character' in req.model_fields_set instead (verified
    # directly: Pydantic v2 tracks presence-in-input separately from the
    # resolved value). Desktop's own apiPut call never sends this field,
    # so it's structurally unaffected.
    expected_character: Optional[str] = None


class SlotRequest(BaseModel):
    slot_index: int


def _push(db: Session, room: DraftRoom):
    ws_manager.push(f"draft:{room.id}", draft_room_to_dict(db, room, viewer_id=None))


def _prefill_fill_order(db: Session, player_id: int) -> list[str]:
    """The candidate character order for one player's pre-fill, longer than
    any real chars_per_player -- the caller truncates. Two tiers, in order:

      1. Most-played (CharacterStats.wins + losses, descending; ties broken
         by most-recently-played, not alphabetically -- see below),
         characters with zero games excluded -- a character nobody's
         played isn't "most played", it just hasn't been touched.
      2. Starred favorites, in saved order, with anything already listed in
         tier 1 skipped so the same character never appears twice.

    Nothing outside these two lists is ever included -- an empty result
    (new player, no favorites) is correct, not a bug; the caller leaves
    those slots empty rather than inventing a pick from the wider roster.

    Tiebreak note: alphabetical was the first cut here, but it's an
    arbitrary axis -- a player with a spread of 1-2-game characters would
    get the exact same alphabetically-biased fill every single draft,
    forever. CharacterStats.updated_at (onupdate=_now) is already loaded on
    every row here and needs no new query: record_match (routers/matches.py)
    is the ONLY writer that ever touches a CharacterStats row's wins/losses/
    elo/kills/deaths (confirmed by grep -- every other reference in the
    codebase is a read), so onupdate necessarily stamps updated_at at the
    exact moment a match involving that character is recorded. That makes
    it a real "last played" timestamp, not a coincidental side effect of
    some unrelated write. Two stable sorts (not one sort on a combined key)
    so the datetime side doesn't need its own None-handling or negation
    trick: pre-sort by recency, then a second stable sort by games-played
    preserves that recency order within each tied games-played group.
    """
    stats_rows = db.query(CharacterStats).filter(CharacterStats.user_id == player_id).all()
    candidates = [r for r in stats_rows if (r.wins + r.losses) > 0]
    # updated_at == "last played" only holds while record_match stays the
    # sole writer (see the column comment in database.py) -- a future stats
    # recompute/backfill script would silently turn this into "last
    # recomputed" with no error and no visible symptom here.
    by_recency = sorted(candidates, key=lambda r: r.updated_at or _EPOCH, reverse=True)
    most_played = sorted(by_recency, key=lambda r: -(r.wins + r.losses))
    order = [r.character for r in most_played]

    fav = db.query(FavoriteCharacters).filter(FavoriteCharacters.owner_id == player_id).first()
    seen = set(order)
    for c in (fav.characters if fav else []) or []:
        if c not in seen:
            order.append(c)
            seen.add(c)
    return order


def _prefill_picks_for_player(db: Session, room: DraftRoom, player_id: int) -> None:
    """Writes real DraftPick rows for this player's pre-fill, same shape
    pick_draft_character itself would write -- not local-only state, so the
    picks survive a refresh and other players see the slot count immediately
    over the WS push start_draft_room already sends. Only ever called from
    start_draft_room at the lobby -> picking transition (see that function's
    own comment for why that makes this exactly-once with no extra flag
    needed); existing-row guard below is defensive insurance, not a live
    path -- pick_draft_character requires status == 'picking', which can't
    be true yet for any player at the moment this runs.
    """
    order = _prefill_fill_order(db, player_id)[: room.chars_per_player]
    if not order:
        return
    existing_slots = {
        p.slot_index for p in db.query(DraftPick).filter(
            DraftPick.room_id == room.id, DraftPick.player_id == player_id
        ).all()
    }
    for slot_index, character in enumerate(order):
        if slot_index in existing_slots:
            continue
        db.add(DraftPick(room_id=room.id, player_id=player_id, slot_index=slot_index, character=character))


def _deal_bracket(entries_by_player: dict, chars_per_player: int) -> list:
    """Seeds bracket positions so every consecutive run of `group_size` positions
    holds at most one entry per player -- the invariant that guarantees no
    self-match before groups start merging across each other. Each value in
    entries_by_player is that player's picks; each entry is {"player_id", "character"}.

    chars_per_player is passed in explicitly (from room.chars_per_player) rather
    than inferred from one player's list length -- trusting an arbitrary player's
    count and then indexing pools[p][g] for every other player means one short
    list (a NULL-character row, a mid-draft leave, a partial write) raises
    IndexError at the exact moment the room goes live. Validated up front instead.

    Deliberate scope simplification: seeding is random-but-constrained, not
    elo-based -- bracket-engine.js's buildBracketPairs() seeding logic is
    client-side JS and isn't reusable from this Python backend."""
    if not _is_power_of_two(chars_per_player):
        raise ValueError(f"chars_per_player must be a power of two, got {chars_per_player}")

    players = list(entries_by_player.keys())
    n = len(players)
    for p in players:
        if len(entries_by_player[p]) != chars_per_player:
            raise ValueError(f"player {p} has {len(entries_by_player[p])} picks, expected {chars_per_player}")
    group_size = _next_power_of_two(n)

    pools = {p: random.sample(entries_by_player[p], len(entries_by_player[p])) for p in players}

    seeds: list = []
    for g in range(chars_per_player):
        order = random.sample(players, len(players))
        for p in order:
            seeds.append(pools[p][g])
        for _ in range(n, group_size):
            seeds.append(None)
    return seeds


def _build_free_pool_bracket(seeds: list, users_by_id: dict):
    """Return (bracket_data, entries, round_winners) for the draft's single Bracket
    row from dealt seed positions. Matches tournament.html's own BYE convention
    exactly (bare 'BYE' label, not the 'SYSTEM — BYE' form bracket-engine.js uses
    for its own client-only entries list) since tournament.html is the page these
    brackets are viewed through. A bye pair's winner is pre-resolved into
    round_winners at creation time -- tournament.html has no auto-bye-advance of
    its own (confirmed by reading it: PATCH /brackets/{id}/winner is only ever
    called from a human recording a real match), so leaving it unresolved would
    strand the bracket. With chars_per_player > 1 and n == 3, a bye lands in
    every group, not just a single trailing one -- each pair is resolved
    independently rather than assuming at most one bye overall."""
    bracket_data, entries, round_winners = [], [], {}
    for mi in range(0, len(seeds), 2):
        a, b = seeds[mi], seeds[mi + 1]
        if a is None and b is None:
            # Unreachable today (n in {2,3,4} means at most one bye per group of
            # up to 4), but num_players exists specifically so a larger N can
            # come later -- at n=5, group_size=8 gives three Nones per group,
            # and an unguarded bye-vs-bye pair has no round_winners entry and
            # can never resolve. Fail loudly here instead of shipping a stuck bracket.
            raise ValueError(f"bye vs bye at match {mi // 2} -- group_size exceeds num_players by more than one bye slot")
        a_label = "BYE" if a is None else f"{users_by_id[a['player_id']].username} — {a['character']}"
        b_label = "BYE" if b is None else f"{users_by_id[b['player_id']].username} — {b['character']}"
        m = mi // 2
        bracket_data.append({"a": a_label, "b": b_label})
        if a is not None:
            entries.append({"player": users_by_id[a['player_id']].username, "character": a['character']})
        if b is not None:
            entries.append({"player": users_by_id[b['player_id']].username, "character": b['character']})
        if a is None and b is not None:
            round_winners[f"r0_m{m}"] = b_label
        elif b is None and a is not None:
            round_winners[f"r0_m{m}"] = a_label
    return bracket_data, entries, round_winners


def _create_draft_brackets_and_go_live(db: Session, room: DraftRoom, pick_rows: list):
    """Creates one live free-pool Bracket row containing every player's every pick,
    seeded via _deal_bracket so no two entries from the same player can meet
    before the structurally-guaranteed-safe round, and flips room.status straight
    to 'live' with bracket_ids populated -- all before the caller's single commit,
    so no client ever observes a separately-broadcast 'revealed' state."""
    players = room.players or []
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(players)).all()}
    usernames = [users_by_id[pid].username for pid in players if pid in users_by_id]

    entries_by_player: dict = {}
    for pid in players:
        if pid not in users_by_id:
            continue
        player_picks = sorted((p for p in pick_rows if p.player_id == pid), key=lambda p: p.slot_index)
        entries_by_player[pid] = [{"player_id": pid, "character": p.character} for p in player_picks]

    seeds = _deal_bracket(entries_by_player, room.chars_per_player)
    bracket_data, entries, round_winners = _build_free_pool_bracket(seeds, users_by_id)

    bracket = Bracket(
        user_id=room.host_id,
        name=f"Draft #{room.id}",
        mode="draft",
        players=usernames,
        entries=entries,
        bracket_data=bracket_data,
        round_winners=round_winners,
        is_live=True,
        chars_per_player=room.chars_per_player,
    )
    db.add(bracket)
    db.flush()

    room.bracket_ids = [bracket.id]
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
        "created_at": to_utc_iso(room.created_at),
    }


@router.post("/draft/rooms")
def create_draft_room(req: DraftRoomCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if req.chars_per_player not in VALID_CHARS_PER_PLAYER or not _is_power_of_two(req.chars_per_player):
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

    # Pre-fill: runs exactly once per room because this transition itself
    # does -- join_draft_room only accepts new players while status ==
    # 'lobby' (so room.players is frozen by the time we get here), and the
    # guard above (`if room.status != 'lobby': raise 400`) means a given
    # room can only ever pass through this line once. That makes "once per
    # player per room" a property of *when* this runs, not something that
    # needs its own tracking column -- deliberately not a "has this player
    # been pre-filled" flag: the naive alternative (fill on component mount
    # if slots are empty) is exactly the bug this avoids, since a player who
    # deliberately clears every slot would look identical to a never-filled
    # one and get refilled on the next refresh.
    users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(room.players or [])).all()}
    for pid in room.players or []:
        user = users_by_id.get(pid)
        if user is not None and user.draft_prefill_enabled:
            _prefill_picks_for_player(db, room, pid)
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
    # "" and None both mean "clear this slot" -- normalize once here so the
    # DB only ever stores a real character name or a true NULL, never a
    # stray empty string (see PickUpdate.character).
    character = req.character or None

    # Fetched before the duplicate check (moved up from below it) so the
    # optimistic-concurrency guard has this slot's real current value to
    # compare against. Pure reordering of a read -- doesn't change what the
    # duplicate check below sees or does.
    pick = db.query(DraftPick).filter(
        DraftPick.room_id == room_id,
        DraftPick.player_id == current_user.id,
        DraftPick.slot_index == req.slot_index,
    ).first()

    # Optimistic-concurrency guard: only runs when the caller actually sent
    # expected_character (see PickUpdate's comment on why presence, not
    # value, is what's checked). Applies uniformly to the whole request --
    # a pick and a clear are both just "character the caller wants this
    # slot to end up holding" -- so a clear made against a stale belief
    # about what's currently there fails exactly the same way a pick does,
    # rather than needing its own separate check.
    #
    # "Empty" has three representations here, not one: no DraftPick row at
    # all, a row with character IS NULL, and -- historically, before the
    # `character = req.character or None` normalization a few lines up
    # existed at all -- a row that got written with character = ''
    # directly. All three have to compare equal to a null expectation, or a
    # perfectly legitimate first pick into a slot that happens to carry an
    # old empty-string row 409s for no real reason. `or None` on both sides
    # collapses all three (missing row, NULL, '') to the same None -- not
    # just on `expected` (a fresh request can't produce '' post-
    # normalization) but on `actual` too, since a pre-existing '' row is
    # exactly the case the request-side normalization can't reach.
    if "expected_character" in req.model_fields_set:
        expected = req.expected_character or None
        actual = (pick.character if pick else None) or None
        if expected != actual:
            return JSONResponse(status_code=409, content={
                "detail": "Your view of this slot is out of date.",
                "actual_character": actual,
            })

    if character:
        dup = db.query(DraftPick).filter(
            DraftPick.room_id == room_id,
            DraftPick.player_id == current_user.id,
            DraftPick.character == character,
            DraftPick.slot_index != req.slot_index,
        ).first()
        if dup:
            raise HTTPException(status_code=400, detail="You've already picked that character for another slot")

    if pick and pick.locked_at is not None:
        raise HTTPException(status_code=400, detail="Slot is already locked")
    if pick:
        pick.character = character
    else:
        pick = DraftPick(room_id=room_id, player_id=current_user.id, slot_index=req.slot_index, character=character)
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
