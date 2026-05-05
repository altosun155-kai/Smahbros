import asyncio
import uuid
from fastapi import WebSocket

TICK_RATE        = 20   # Hz
ARENA_W          = 800
ARENA_H          = 600
PLAYER_SPEED     = 4    # px per tick
PLAYER_R         = 24   # collision radius
BOOM_R           = 8
BOOM_SPEED       = 8
BOOM_RETURN_AFTER = 30  # ticks before boomerang returns
SLASH_R          = 60   # slash hit radius
SLASH_COOLDOWN   = 40   # ticks (~2s at 20Hz)


class Player:
    def __init__(self, slot: int, username: str, ws: WebSocket):
        self.slot     = slot
        self.username = username
        self.ws       = ws
        self.x        = 200.0 if slot == 0 else 600.0
        self.y        = 300.0
        self.hp            = 1
        self.inputs        = {"up": False, "down": False, "left": False, "right": False}
        self.slash_cooldown = 0
        self.slashing      = 0  # ticks remaining in slash animation


class Boomerang:
    def __init__(self, owner: int, x: float, y: float, dx: float, dy: float):
        self.id        = uuid.uuid4().hex[:8]
        self.owner     = owner
        self.x         = x
        self.y         = y
        self.dx        = dx
        self.dy        = dy
        self.returning = False
        self.age       = 0


class GameRoom:
    def __init__(self, room_id: str):
        self.room_id    = room_id
        self.players: list[Player | None] = [None, None]
        self.boomerangs: list[Boomerang]  = []
        self.phase      = "waiting"   # waiting | playing | done
        self.winner: int | None = None
        self.tick_task: asyncio.Task | None = None


_rooms: dict[str, GameRoom] = {}


def get_room(room_id: str) -> GameRoom | None:
    return _rooms.get(room_id)


def join_room(room_id: str, username: str, ws: WebSocket) -> tuple[GameRoom, int] | None:
    room = _rooms.setdefault(room_id, GameRoom(room_id))
    for slot, p in enumerate(room.players):
        if p is None:
            room.players[slot] = Player(slot, username, ws)
            return room, slot
    return None  # full


def leave_room(room_id: str, slot: int) -> None:
    room = _rooms.get(room_id)
    if not room:
        return
    room.players[slot] = None
    if all(p is None for p in room.players):
        if room.tick_task:
            room.tick_task.cancel()
        _rooms.pop(room_id, None)


async def broadcast(room: GameRoom, data: dict) -> None:
    dead = []
    for slot, p in enumerate(room.players):
        if p is None:
            continue
        try:
            await p.ws.send_json(data)
        except Exception:
            dead.append(slot)
    for slot in dead:
        leave_room(room.room_id, slot)


def _step(room: GameRoom) -> None:
    for p in room.players:
        if p is None:
            continue
        if p.inputs["left"]:
            p.x = max(PLAYER_R, p.x - PLAYER_SPEED)
        if p.inputs["right"]:
            p.x = min(ARENA_W - PLAYER_R, p.x + PLAYER_SPEED)
        if p.inputs["up"]:
            p.y = max(PLAYER_R, p.y - PLAYER_SPEED)
        if p.inputs["down"]:
            p.y = min(ARENA_H - PLAYER_R, p.y + PLAYER_SPEED)

    dead_booms: list[Boomerang] = []
    for b in room.boomerangs:
        b.age += 1
        if b.age >= BOOM_RETURN_AFTER:
            b.returning = True

        if b.returning:
            owner = room.players[b.owner]
            if owner is None:
                dead_booms.append(b)
                continue
            dx, dy = owner.x - b.x, owner.y - b.y
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < BOOM_R:
                dead_booms.append(b)
                continue
            b.x += dx / dist * BOOM_SPEED
            b.y += dy / dist * BOOM_SPEED
        else:
            b.x += b.dx
            b.y += b.dy
            if b.x <= 0 or b.x >= ARENA_W:
                b.dx, b.returning = -b.dx, True
            if b.y <= 0 or b.y >= ARENA_H:
                b.dy, b.returning = -b.dy, True

        # hit check against opposing players
        for p in room.players:
            if p is None or p.slot == b.owner:
                continue
            dx, dy = p.x - b.x, p.y - b.y
            if (dx * dx + dy * dy) ** 0.5 < PLAYER_R + BOOM_R:
                p.hp -= 1
                dead_booms.append(b)
                if p.hp <= 0:
                    room.phase  = "done"
                    room.winner = b.owner
                break

    for b in dead_booms:
        if b in room.boomerangs:
            room.boomerangs.remove(b)

    # Tick down slash state
    for p in room.players:
        if p is None:
            continue
        if p.slash_cooldown > 0:
            p.slash_cooldown -= 1
        if p.slashing > 0:
            p.slashing -= 1


async def _tick_loop(room: GameRoom) -> None:
    interval = 1.0 / TICK_RATE
    while room.phase != "done" and any(p is not None for p in room.players):
        _step(room)
        state = {
            "type": "state",
            "players": [
                {"slot": p.slot, "x": round(p.x, 1), "y": round(p.y, 1),
                 "hp": p.hp, "username": p.username}
                if p else None
                for p in room.players
            ],
            "boomerangs": [
                {"id": b.id, "x": round(b.x, 1), "y": round(b.y, 1),
                 "owner": b.owner, "returning": b.returning}
                for b in room.boomerangs
            ],
            "slashing": [p.slashing > 0 if p else False for p in room.players],
            "phase":  room.phase,
            "winner": room.winner,
        }
        await broadcast(room, state)
        await asyncio.sleep(interval)


def start_game(room: GameRoom) -> None:
    room.phase = "playing"
    if room.tick_task is None or room.tick_task.done():
        room.tick_task = asyncio.create_task(_tick_loop(room))


def handle_message(room: GameRoom, slot: int, msg: dict) -> None:
    p = room.players[slot]
    if p is None:
        return

    if msg.get("type") == "input":
        keys = msg.get("keys", {})
        for k in ("up", "down", "left", "right"):
            if k in keys:
                p.inputs[k] = bool(keys[k])

    elif msg.get("type") == "throw":
        if any(b.owner == slot for b in room.boomerangs):
            return  # one boomerang at a time
        dx = float(msg.get("dx", 1.0))
        dy = float(msg.get("dy", 0.0))
        dist = (dx * dx + dy * dy) ** 0.5 or 1.0
        room.boomerangs.append(
            Boomerang(slot, p.x, p.y, dx / dist * BOOM_SPEED, dy / dist * BOOM_SPEED)
        )

    elif msg.get("type") == "slash":
        if p.slash_cooldown > 0:
            return
        p.slash_cooldown = SLASH_COOLDOWN
        p.slashing = 6  # ~0.3s animation
        # Hit nearby enemies
        for other in room.players:
            if other is None or other.slot == slot:
                continue
            dx, dy = other.x - p.x, other.y - p.y
            if (dx * dx + dy * dy) ** 0.5 < SLASH_R:
                other.hp -= 1
                if other.hp <= 0:
                    room.phase  = "done"
                    room.winner = slot
