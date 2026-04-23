# ws_manager.py — WebSocket room manager for live tournament updates
import asyncio
from fastapi import WebSocket

_loop: asyncio.AbstractEventLoop | None = None
_rooms: dict[int, list[WebSocket]] = {}


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


async def connect(tournament_id: int, ws: WebSocket) -> None:
    await ws.accept()
    _rooms.setdefault(tournament_id, []).append(ws)


def disconnect(tournament_id: int, ws: WebSocket) -> None:
    room = _rooms.get(tournament_id, [])
    if ws in room:
        room.remove(ws)
    if not room:
        _rooms.pop(tournament_id, None)


async def _do_broadcast(tournament_id: int, data: dict) -> None:
    dead = []
    for ws in list(_rooms.get(tournament_id, [])):
        try:
            await ws.send_json(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        disconnect(tournament_id, ws)


def push(tournament_id: int, data: dict) -> None:
    """Schedule a broadcast from a sync route handler (thread-safe)."""
    if _loop and _loop.is_running():
        asyncio.run_coroutine_threadsafe(_do_broadcast(tournament_id, data), _loop)
