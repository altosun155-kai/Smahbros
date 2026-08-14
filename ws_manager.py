# ws_manager.py — WebSocket room manager for live tournament updates
import asyncio
from fastapi import WebSocket

_loop: asyncio.AbstractEventLoop | None = None
_rooms: dict[int | str, list[WebSocket]] = {}


def set_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


async def connect(room_key: int | str, ws: WebSocket) -> None:
    # Callers accept() the socket themselves before calling this (they need to
    # receive the client's token frame first) -- accepting again here would crash
    # Starlette's WebSocket state machine, since a socket can only be accepted once.
    _rooms.setdefault(room_key, []).append(ws)


def disconnect(room_key: int | str, ws: WebSocket) -> None:
    room = _rooms.get(room_key, [])
    if ws in room:
        room.remove(ws)
    if not room:
        _rooms.pop(room_key, None)


async def _do_broadcast(room_key: int | str, data: dict) -> None:
    dead = []
    for ws in list(_rooms.get(room_key, [])):
        try:
            await ws.send_json(data)
        except Exception:
            dead.append(ws)
    for ws in dead:
        disconnect(room_key, ws)


def push(room_key: int | str, data: dict) -> None:
    """Schedule a broadcast from a sync route handler (thread-safe)."""
    if _loop and _loop.is_running():
        asyncio.run_coroutine_threadsafe(_do_broadcast(room_key, data), _loop)
