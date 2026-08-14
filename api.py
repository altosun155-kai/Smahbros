import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import os
import logging

from database import engine, Base, SessionLocal, Bracket, TournamentInvite, DraftRoom
from auth import decode_token
from migrations import _run_migrations
from routers import auth, users, badges, brackets, characters, matches, invites, leaderboard, presets, draft
from routers.brackets import bracket_to_dict
from routers.draft import draft_room_to_dict
import ws_manager

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: Base.metadata.create_all(bind=engine))
    await loop.run_in_executor(None, _run_migrations)
    ws_manager.set_loop(loop)
    yield


app = FastAPI(title="Smash Bracket API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


_DEBUG = os.environ.get("DEBUG", "").lower() in ("1", "true", "yes")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.exception("Unhandled error: %s", exc)
    detail = f"{type(exc).__name__}: {exc}" if _DEBUG else "An unexpected error occurred"
    return JSONResponse(status_code=500, content={"detail": detail})


app.include_router(auth.router)
app.include_router(users.router)
app.include_router(badges.router)
app.include_router(brackets.router)
app.include_router(characters.router)
app.include_router(matches.router)
app.include_router(invites.router)
app.include_router(leaderboard.router)
app.include_router(presets.router)
app.include_router(draft.router)


@app.websocket("/ws/tournament/{tournament_id}")
async def ws_tournament(tournament_id: int, websocket: WebSocket):
    await websocket.accept()
    try:
        token = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
    except asyncio.TimeoutError:
        await websocket.close(code=1008)
        return
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=1008)
        return

    db = SessionLocal()
    try:
        b = db.query(Bracket).filter(Bracket.id == tournament_id).first()
        if not b:
            await websocket.close(code=1008)
            return
        is_owner = b.user_id == user_id
        invite = db.query(TournamentInvite).filter_by(
            bracket_id=tournament_id, invitee_id=user_id
        ).first()
        if not is_owner and not invite:
            await websocket.close(code=1008)
            return
        initial = bracket_to_dict(b)
    finally:
        db.close()

    await ws_manager.connect(tournament_id, websocket)
    try:
        await websocket.send_json(initial)
        while True:
            await websocket.receive_text()  # drain client pings; server pushes via broadcast
    except WebSocketDisconnect:
        ws_manager.disconnect(tournament_id, websocket)


@app.websocket("/ws/draft/{room_id}")
async def ws_draft(room_id: int, websocket: WebSocket):
    await websocket.accept()
    try:
        token = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
    except asyncio.TimeoutError:
        await websocket.close(code=1008)
        return
    user_id = decode_token(token)
    if not user_id:
        await websocket.close(code=1008)
        return

    db = SessionLocal()
    try:
        room = db.query(DraftRoom).filter(DraftRoom.id == room_id).first()
        if not room or user_id not in (room.players or []):
            await websocket.close(code=1008)
            return
        initial = draft_room_to_dict(db, room, viewer_id=None)
    finally:
        db.close()

    key = f"draft:{room_id}"
    await ws_manager.connect(key, websocket)
    try:
        await websocket.send_json(initial)
        while True:
            await websocket.receive_text()  # drain client pings; server pushes via broadcast
    except WebSocketDisconnect:
        ws_manager.disconnect(key, websocket)


@app.get("/health")
def health():
    return {"ok": True}


# Serve the web/ frontend — must be last
WEB_DIR = os.path.join(os.path.dirname(__file__), "web", "public")


@app.get("/")
def root():
    return FileResponse(os.path.join(WEB_DIR, "login.html"))


app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="frontend")
