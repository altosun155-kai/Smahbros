import asyncio
import random
import uuid
from fastapi import WebSocket

TICK_RATE         = 20
ARENA_W           = 1440
ARENA_H           = 810
# Playable floor inner boundaries (match client FL/FR/FT/FB)
FLOOR_L = 26
FLOOR_R = 1414
FLOOR_T = 46
FLOOR_B = 764
PLAYER_SPEED      = 6
PLAYER_R          = 24
DART_R          = 7
DART_SPEED      = 16
DART_RANGE      = 420    # fixed flight distance in pixels
DART_SEEP_TICKS = 18     # ticks dart stays stuck before disappearing (~0.9 s)
SLASH_R           = 60
SLASH_COOLDOWN    = 40
DASH_SPEED        = 14
DASH_FRAMES       = 10
DASH_COOLDOWN     = 45

KNOCKBACK_SPEED  = 22
KNOCKBACK_FRAMES = 8

WALL_SPEED     = 10.0   # units per tick while sliding
WALL_H         = 140    # height of each wall slab
WALL_MAX_EXT   = 280    # max extension into arena
WALL_TIMER_MIN = 60     # ticks before toggling (~3 s at 20 tps)
WALL_TIMER_MAX = 220    # ticks (~11 s)

# CPU per-difficulty: (throw_interval_ticks, chase_distance, dodge_range, charge_ratio)
_CPU_DIFF = {
    "easy":   (110, 430, 125, 0.0),
    "normal": (55,  230, 205, 0.4),
    "hard":   (28,  135, 285, 0.9),
}


def _sweep_hit(px0: float, py0: float, px1: float, py1: float,
               bx: float, by: float, r: float) -> bool:
    """True if circle of radius r centred at (bx,by) intersects segment (px0,py0)→(px1,py1)."""
    dx, dy = px1 - px0, py1 - py0
    d2 = dx * dx + dy * dy
    if d2 == 0:
        return (bx - px0) ** 2 + (by - py0) ** 2 < r * r
    t = max(0.0, min(1.0, ((bx - px0) * dx + (by - py0) * dy) / d2))
    nx, ny = px0 + t * dx - bx, py0 + t * dy - by
    return nx * nx + ny * ny < r * r


class Player:
    def __init__(self, slot: int, username: str, ws, is_cpu: bool = False, cpu_diff: str = "normal"):
        self.slot     = slot
        self.username = username
        self.ws       = ws
        self.is_cpu   = is_cpu
        self.x        = 360.0 if slot == 0 else 1080.0
        self.y        = 405.0
        self.hp            = 1
        self.inputs        = {"up": False, "down": False, "left": False, "right": False}
        self.slash_cooldown = 0
        self.slashing       = 0
        self.dash_frames    = 0
        self.dash_cooldown  = 0
        self.dash_dx        = 0.0
        self.dash_dy        = 0.0
        self.throw_charging = False
        self.throw_charge   = 0
        self.kb_vx = 0.0
        self.kb_vy = 0.0
        self.kb_frames = 0
        self.has_crown = False
        self.ability   = 'normal'
        self.throw_charging = False   # kept for _advance_round compat
        self.throw_charge   = 0
        if is_cpu:
            throw_cd, chase_dist, dodge_r, charge_r = _CPU_DIFF.get(cpu_diff, _CPU_DIFF["normal"])
            self.cpu_throw_cd     = throw_cd
            self.cpu_chase_dist   = chase_dist
            self.cpu_dodge_range  = dodge_r
            self.cpu_charge_ratio = charge_r
            self.cpu_throw_timer  = throw_cd


class Dart:
    def __init__(self, owner: int, x: float, y: float, dx: float, dy: float,
                 ability: str = 'normal'):
        self.id          = uuid.uuid4().hex[:8]
        self.owner       = owner
        self.x           = x
        self.y           = y
        self.dx          = dx   # velocity components (pre-scaled to DART_SPEED)
        self.dy          = dy
        self.ability     = ability
        self.stuck       = False
        self.stuck_timer = DART_SEEP_TICKS
        self.age         = 0
        self.dist        = 0.0   # pixels traveled so far


class MovingWall:
    def __init__(self, wid: int, side: str, y: float):
        self.id      = wid
        self.side    = side        # 'left' or 'right'
        self.y       = y           # center Y in arena
        self.h       = WALL_H
        self.max_ext = WALL_MAX_EXT
        self.extend  = 0.0         # current extension (0 = retracted)
        self.target  = 0.0         # target extension
        self.timer   = random.randint(WALL_TIMER_MIN, WALL_TIMER_MAX)


class GameRoom:
    def __init__(self, room_id: str):
        self.room_id     = room_id
        self.players: list[Player | None] = [None, None]
        self.darts: list[Dart]           = []
        self.walls       = [
            MovingWall(0, 'left',  270),   # upper-left slab
            MovingWall(1, 'right', 540),   # lower-right slab
        ]
        self.phase       = "waiting"
        self.winner: int | None = None
        self.tick_task: asyncio.Task | None = None
        self.is_cpu_game  = False
        self.rounds_won   = [0, 0]
        self.round_num    = 1
        self.match_winner = None


def _wall_rect(w: MovingWall) -> tuple | None:
    """Return (x1, y1, x2, y2) of the wall's current footprint, or None if retracted."""
    if w.extend < 1:
        return None
    hy = w.h / 2
    if w.side == 'left':
        return (FLOOR_L, w.y - hy, FLOOR_L + w.extend, w.y + hy)
    return (FLOOR_R - w.extend, w.y - hy, FLOOR_R, w.y + hy)


def _push_out_of_wall(p: Player, w: MovingWall) -> None:
    """Push player circle out of the wall rect if overlapping."""
    rect = _wall_rect(w)
    if not rect:
        return
    x1, y1, x2, y2 = rect
    clx = max(x1, min(p.x, x2))
    cly = max(y1, min(p.y, y2))
    dx, dy = p.x - clx, p.y - cly
    dist_sq = dx * dx + dy * dy
    if dist_sq < PLAYER_R * PLAYER_R:
        dist = dist_sq ** 0.5
        if dist < 0.01:
            # Center is inside wall — eject horizontally away from wall face
            dx, dy, dist = (1.0, 0.0, 1.0) if w.side == 'right' else (-1.0, 0.0, 1.0)
        overlap = PLAYER_R - dist + 1
        p.x = max(PLAYER_R, min(ARENA_W - PLAYER_R, p.x + dx / dist * overlap))
        p.y = max(PLAYER_R, min(ARENA_H - PLAYER_R, p.y + dy / dist * overlap))


def _resolve_hit(room: GameRoom, victim: Player, attacker_slot: int,
                 from_x: float, from_y: float) -> None:
    victim.hp -= 1
    dx = victim.x - from_x
    dy = victim.y - from_y
    dist = (dx * dx + dy * dy) ** 0.5 or 1.0
    victim.kb_vx = dx / dist * KNOCKBACK_SPEED
    victim.kb_vy = dy / dist * KNOCKBACK_SPEED
    victim.kb_frames = KNOCKBACK_FRAMES
    if victim.hp <= 0:
        room.phase  = "round_over"
        room.winner = attacker_slot


def _advance_round(room: GameRoom) -> None:
    prev_winner = room.winner
    room.rounds_won[room.winner] += 1
    if room.rounds_won[room.winner] >= 2:
        room.phase        = "game_over"
        room.match_winner = room.winner
        return
    room.round_num += 1
    room.winner     = None
    room.phase      = "playing"
    room.darts.clear()
    for w in room.walls:
        w.extend = 0.0
        w.target = 0.0
        w.timer  = random.randint(WALL_TIMER_MIN, WALL_TIMER_MAX)
    for p in room.players:
        if p is None:
            continue
        p.has_crown      = (p.slot == prev_winner)  # crown goes to last round's winner
        p.x = 360.0 if p.slot == 0 else 1080.0
        p.y = 405.0
        p.hp = 1
        for k in p.inputs:
            p.inputs[k] = False
        p.slash_cooldown = 0
        p.slashing       = 0
        p.dash_frames    = 0
        p.dash_cooldown  = 0
        p.throw_charging = False
        p.throw_charge   = 0
        p.kb_vx = 0.0
        p.kb_vy = 0.0
        p.kb_frames = 0


_ROUND_OVER_TICKS = TICK_RATE * 2  # 2-second animation window between rounds

_rooms: dict[str, GameRoom] = {}


def get_room(room_id: str) -> GameRoom | None:
    return _rooms.get(room_id)


def join_room(room_id: str, username: str, ws) -> tuple[GameRoom, int] | None:
    room = _rooms.setdefault(room_id, GameRoom(room_id))
    for slot, p in enumerate(room.players):
        if p is None:
            room.players[slot] = Player(slot, username, ws)
            return room, slot
    return None


def join_cpu_room(room_id: str, username: str, ws, difficulty: str = "normal") -> tuple[GameRoom, int]:
    room = GameRoom(room_id)
    room.is_cpu_game = True
    _rooms[room_id] = room
    room.players[0] = Player(0, username, ws)
    room.players[1] = Player(1, "CPU", None, is_cpu=True, cpu_diff=difficulty)
    return room, 0


def leave_room(room_id: str, slot: int) -> None:
    room = _rooms.get(room_id)
    if not room:
        return
    room.players[slot] = None
    if room.is_cpu_game:
        room.players = [None, None]
    if all(p is None for p in room.players):
        if room.tick_task:
            room.tick_task.cancel()
        _rooms.pop(room_id, None)


async def broadcast(room: GameRoom, data: dict) -> None:
    dead = []
    for slot, p in enumerate(room.players):
        if p is None or p.is_cpu:
            continue
        try:
            await p.ws.send_json(data)
        except Exception:
            dead.append(slot)
    for slot in dead:
        leave_room(room.room_id, slot)


def _cpu_ai(cpu: Player, room: GameRoom) -> None:
    human = next((p for p in room.players if p and not p.is_cpu), None)
    if not human:
        return

    dx   = human.x - cpu.x
    dy   = human.y - cpu.y
    dist = (dx * dx + dy * dy) ** 0.5 or 1.0

    # Dash away from very close incoming darts
    if cpu.dash_cooldown <= 0 and cpu.dash_frames <= 0:
        for d in room.darts:
            if d.owner == cpu.slot or d.stuck:
                continue
            bdx = cpu.x - d.x
            bdy = cpu.y - d.y
            b_dist = (bdx * bdx + bdy * bdy) ** 0.5 or 1.0
            if b_dist < cpu.cpu_dodge_range * 0.55:
                cpu.dash_dx = bdx / b_dist * DASH_SPEED
                cpu.dash_dy = bdy / b_dist * DASH_SPEED
                cpu.dash_frames   = DASH_FRAMES
                cpu.dash_cooldown = DASH_COOLDOWN
                break

    # Dodge incoming darts (movement-level)
    dodging = False
    for d in room.darts:
        if d.owner == cpu.slot or d.stuck:
            continue
        bdx = cpu.x - d.x
        bdy = cpu.y - d.y
        if (bdx * bdx + bdy * bdy) ** 0.5 < cpu.cpu_dodge_range:
            cpu.inputs = {
                "up":    d.dy > 0,
                "down":  d.dy < 0,
                "left":  d.dx > 0,
                "right": d.dx < 0,
            }
            dodging = True
            break

    if not dodging:
        cpu.inputs = {"up": False, "down": False, "left": False, "right": False}
        if dist > cpu.cpu_chase_dist:
            if dx >  20: cpu.inputs["right"] = True
            elif dx < -20: cpu.inputs["left"]  = True
            if dy >  20: cpu.inputs["down"]  = True
            elif dy < -20: cpu.inputs["up"]    = True

    # Shoot dart toward human
    has_dart = any(d.owner == cpu.slot for d in room.darts)
    if not has_dart:
        if cpu.cpu_throw_timer <= 0 and 110 < dist < 900:
            norm = dist or 1.0
            room.darts.append(
                Dart(cpu.slot, cpu.x, cpu.y,
                     dx / norm * DART_SPEED, dy / norm * DART_SPEED,
                     ability=cpu.ability)
            )
            cpu.cpu_throw_timer = cpu.cpu_throw_cd
        else:
            cpu.cpu_throw_timer = max(0, cpu.cpu_throw_timer - 1)
    else:
        cpu.cpu_throw_timer = max(0, cpu.cpu_throw_timer - 1)

    # Slash when close
    if dist < SLASH_R * 0.8 and cpu.slash_cooldown <= 0:
        cpu.slash_cooldown = SLASH_COOLDOWN
        cpu.slashing = 6
        for other in room.players:
            if other is None or other.slot == cpu.slot:
                continue
            odx, ody = other.x - cpu.x, other.y - cpu.y
            if (odx * odx + ody * ody) ** 0.5 < SLASH_R:
                _resolve_hit(room, other, cpu.slot, cpu.x, cpu.y)


def _step(room: GameRoom) -> None:
    # During round-over, only drain knockback so the death-kick animates
    if room.phase == "round_over":
        for p in room.players:
            if p is None or p.kb_frames <= 0:
                continue
            p.x = max(PLAYER_R, min(ARENA_W - PLAYER_R, p.x + p.kb_vx))
            p.y = max(PLAYER_R, min(ARENA_H - PLAYER_R, p.y + p.kb_vy))
            p.kb_vx *= 0.80
            p.kb_vy *= 0.80
            p.kb_frames -= 1
        return

    if room.phase != "playing":
        return

    for p in room.players:
        if p and p.is_cpu:
            _cpu_ai(p, room)

    for p in room.players:
        if p is None:
            continue
        if p.kb_frames > 0:
            p.x = max(PLAYER_R, min(ARENA_W - PLAYER_R, p.x + p.kb_vx))
            p.y = max(PLAYER_R, min(ARENA_H - PLAYER_R, p.y + p.kb_vy))
            p.kb_vx *= 0.80
            p.kb_vy *= 0.80
            p.kb_frames -= 1
        elif p.dash_frames > 0:
            px0, py0 = p.x, p.y
            px1 = max(PLAYER_R, min(ARENA_W - PLAYER_R, p.x + p.dash_dx))
            py1 = max(PLAYER_R, min(ARENA_H - PLAYER_R, p.y + p.dash_dy))
            for d in list(room.darts):
                if d.owner == p.slot or d.stuck:
                    continue
                dx_end, dy_end = d.x + d.dx, d.y + d.dy
                if _sweep_hit(px0, py0, px1, py1, dx_end, dy_end, PLAYER_R + DART_R):
                    room.darts.remove(d)
                    _resolve_hit(room, p, d.owner, d.x, d.y)
                    break
            p.x, p.y = px1, py1
            p.dash_frames -= 1
        else:
            if p.inputs["left"]:  p.x = max(PLAYER_R, p.x - PLAYER_SPEED)
            if p.inputs["right"]: p.x = min(ARENA_W - PLAYER_R, p.x + PLAYER_SPEED)
            if p.inputs["up"]:    p.y = max(PLAYER_R, p.y - PLAYER_SPEED)
            if p.inputs["down"]:  p.y = min(ARENA_H - PLAYER_R, p.y + PLAYER_SPEED)

    dead_darts: list[Dart] = []
    for d in room.darts:
        if d.stuck:
            d.stuck_timer -= 1
            if d.stuck_timer <= 0:
                dead_darts.append(d)
            continue

        d.age  += 1
        d.dist += DART_SPEED
        d.x    += d.dx
        d.y    += d.dy

        # Auto-stick when fixed range reached
        if d.dist >= DART_RANGE:
            d.stuck = True
            continue

        # Arena wall → stick
        wall_hit = False
        if d.x < FLOOR_L:
            d.x = FLOOR_L + DART_R; wall_hit = True
        elif d.x > FLOOR_R:
            d.x = FLOOR_R - DART_R; wall_hit = True
        if d.y < FLOOR_T:
            d.y = FLOOR_T + DART_R; wall_hit = True
        elif d.y > FLOOR_B:
            d.y = FLOOR_B - DART_R; wall_hit = True
        if wall_hit:
            d.stuck = True
            continue

        # Moving wall → stick
        for w in room.walls:
            rect = _wall_rect(w)
            if rect and rect[0] <= d.x <= rect[2] and rect[1] <= d.y <= rect[3]:
                d.stuck = True
                break
        if d.stuck:
            continue

        # Player hit / deflect
        for p in room.players:
            if p is None or p.slot == d.owner:
                continue
            pdx, pdy = p.x - d.x, p.y - d.y
            if (pdx * pdx + pdy * pdy) ** 0.5 < PLAYER_R + DART_R:
                if p.slashing > 0:
                    orig = room.players[d.owner]
                    d.owner = p.slot
                    d.age   = 0
                    d.dist  = 0.0
                    if orig:
                        td = ((orig.x - p.x) ** 2 + (orig.y - p.y) ** 2) ** 0.5 or 1.0
                        d.dx = (orig.x - p.x) / td * DART_SPEED
                        d.dy = (orig.y - p.y) / td * DART_SPEED
                    else:
                        d.dx, d.dy = -d.dx, -d.dy
                else:
                    dead_darts.append(d)
                    _resolve_hit(room, p, d.owner, d.x, d.y)
                break

    for d in dead_darts:
        if d in room.darts:
            room.darts.remove(d)

    for p in room.players:
        if p is None:
            continue
        if p.slash_cooldown > 0: p.slash_cooldown -= 1
        if p.slashing > 0:       p.slashing -= 1
        if p.dash_cooldown > 0:  p.dash_cooldown -= 1

    # Moving walls: slide toward target, toggle on timer, push players out
    for w in room.walls:
        diff = w.target - w.extend
        if abs(diff) <= WALL_SPEED:
            w.extend = w.target
        else:
            w.extend += WALL_SPEED if diff > 0 else -WALL_SPEED
        w.timer -= 1
        if w.timer <= 0:
            w.target = w.max_ext if w.target == 0 else 0
            w.timer  = random.randint(WALL_TIMER_MIN, WALL_TIMER_MAX)
        for p in room.players:
            if p is not None:
                _push_out_of_wall(p, w)


async def _tick_loop(room: GameRoom) -> None:
    interval = 1.0 / TICK_RATE
    round_over_timer = 0

    while any(p is not None for p in room.players) and room.phase != "game_over":
        _step(room)
        state = {
            "type": "state",
            "players": [
                {"slot": p.slot, "x": round(p.x, 1), "y": round(p.y, 1),
                 "hp": p.hp, "username": p.username}
                if p else None
                for p in room.players
            ],
            "darts": [
                {"id": d.id, "x": round(d.x, 1), "y": round(d.y, 1),
                 "owner": d.owner, "stuck": d.stuck, "ability": d.ability,
                 "ndx": round(d.dx / DART_SPEED, 3), "ndy": round(d.dy / DART_SPEED, 3)}
                for d in room.darts
            ],
            "dart_ready":   [not any(d.owner == i for d in room.darts) for i in range(2)],
            "slashing":     [p.slashing > 0 if p else False for p in room.players],
            "dashing":      [p.dash_frames > 0 if p else False for p in room.players],
            "phase":        room.phase,
            "winner":       room.winner,
            "rounds_won":   room.rounds_won[:],
            "round_num":    room.round_num,
            "match_winner": room.match_winner,
            "crowned":      [p.has_crown if p else False for p in room.players],
            "walls":        [{"id": w.id, "side": w.side, "y": w.y, "h": w.h,
                               "extend": round(w.extend, 1)} for w in room.walls],
        }
        await broadcast(room, state)

        if room.phase == "round_over":
            round_over_timer += 1
            if round_over_timer >= _ROUND_OVER_TICKS:
                round_over_timer = 0
                _advance_round(room)
        else:
            round_over_timer = 0

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

    elif msg.get("type") == "shoot":
        if any(d.owner == slot for d in room.darts):
            return  # dart still in play
        dx   = float(msg.get("dx", 1.0))
        dy   = float(msg.get("dy", 0.0))
        dist = (dx * dx + dy * dy) ** 0.5 or 1.0
        room.darts.append(
            Dart(slot, p.x, p.y,
                 dx / dist * DART_SPEED, dy / dist * DART_SPEED,
                 ability=p.ability)
        )

    elif msg.get("type") == "dash":
        if p.dash_cooldown > 0 or p.dash_frames > 0:
            return
        dx = float(msg.get("dx", 0.0))
        dy = float(msg.get("dy", 0.0))
        if dx == 0 and dy == 0:
            other = next((op for op in room.players if op and op.slot != slot), None)
            if other:
                dx, dy = other.x - p.x, other.y - p.y
            else:
                dx = 1.0
        dist = (dx * dx + dy * dy) ** 0.5 or 1.0
        p.dash_dx = dx / dist * DASH_SPEED
        p.dash_dy = dy / dist * DASH_SPEED
        p.dash_frames   = DASH_FRAMES
        p.dash_cooldown = DASH_COOLDOWN

    elif msg.get("type") == "slash":
        if p.slash_cooldown > 0:
            return
        p.slash_cooldown = SLASH_COOLDOWN
        p.slashing = 6
        for other in room.players:
            if other is None or other.slot == slot:
                continue
            dx, dy = other.x - p.x, other.y - p.y
            if (dx * dx + dy * dy) ** 0.5 < SLASH_R:
                _resolve_hit(room, other, slot, p.x, p.y)
