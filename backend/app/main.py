from __future__ import annotations
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.database import init_db, AsyncSessionLocal
from app.api import auth, documents, ai, compile
from app.api import projects, versions
from app.websocket.rooms import handle_room
from app.websocket.projects import handle_project_room
from app.websocket.yjs_handler import handle_yjs_room
from app.models.user import User
from app.redis_client import redis_client
import app.models  # noqa: F401

app = FastAPI(title="LaTeX Collaborative Editor", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(versions.router)
app.include_router(ai.router)
app.include_router(compile.router)


@app.on_event("startup")
async def startup():
    await init_db()
    await redis_client.ping()


@app.on_event("shutdown")
async def shutdown():
    await redis_client.aclose()


@app.get("/health")
async def health():
    return {"status": "ok"}


async def _authenticate_ws(websocket: WebSocket):
    access_token = websocket.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)
    refresh_token = websocket.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    user_id = await auth.get_authenticated_user_id_from_cookies(access_token, refresh_token)
    return {"user_id": user_id} if user_id else None


@app.websocket("/ws/{doc_id}/sync")
async def yjs_websocket_endpoint(
    websocket: WebSocket,
    doc_id: str,
):
    auth_data = await _authenticate_ws(websocket)
    if not auth_data:
        await websocket.close(code=4001, reason="Unauthorized")
        return
    await handle_yjs_room(websocket, doc_id, auth_data["user_id"])


@app.websocket("/ws/{doc_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    doc_id: str,
):
    auth_data = await _authenticate_ws(websocket)
    if not auth_data:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    user_id = auth_data["user_id"]

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            await websocket.close(code=4001, reason="User not found")
            return
        await handle_room(websocket, doc_id, user_id, user.username, db)


@app.websocket("/ws/project/{project_id}")
async def project_websocket_endpoint(
    websocket: WebSocket,
    project_id: str,
):
    auth_data = await _authenticate_ws(websocket)
    if not auth_data:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    user_id = auth_data["user_id"]

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            await websocket.close(code=4001, reason="User not found")
            return
        await handle_project_room(websocket, project_id, user_id, user.username, db)
