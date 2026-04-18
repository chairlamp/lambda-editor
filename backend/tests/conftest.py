import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:////tmp/lambda_editor_test.db"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["LLM_PROVIDER"] = "openai"
os.environ["OPENAI_API_KEY"] = "test"
os.environ["SECRET_KEY"] = "test"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import pytest_asyncio
import fakeredis.aioredis
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

import app.redis_client as redis_module

# Re-bind references that imported redis_client at module load.
import app.api.auth as auth_module
import app.websocket.manager as manager_module

from app.config import settings
from app.database import AsyncSessionLocal, Base, engine
from app.api import ai, auth, projects, documents, versions
from app.models.user import User
from app.websocket.projects import handle_project_room
from app.websocket.rooms import handle_room
import app.models  # noqa: F401

app = FastAPI()
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(versions.router)
app.include_router(ai.router)


async def _authenticate_ws(websocket: WebSocket):
    access_token = websocket.cookies.get(settings.ACCESS_TOKEN_COOKIE_NAME)
    refresh_token = websocket.cookies.get(settings.REFRESH_TOKEN_COOKIE_NAME)
    user_id = await auth.get_authenticated_user_id_from_cookies(access_token, refresh_token)
    return {"user_id": user_id} if user_id else None


@app.websocket("/ws/{doc_id}")
async def websocket_endpoint(websocket: WebSocket, doc_id: str):
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
async def project_websocket_endpoint(websocket: WebSocket, project_id: str):
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


@pytest_asyncio.fixture(autouse=True)
async def _reset_db():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    redis_module.redis_client = fake
    auth_module.redis_client = fake
    manager_module.redis_client = fake

    for room in list(manager_module.manager.rooms.values()):
        await room.close()
    manager_module.manager.rooms.clear()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    await fake.flushall()
    yield
    for room in list(manager_module.manager.rooms.values()):
        await room.close()
    manager_module.manager.rooms.clear()
    await fake.flushall()
    await fake.aclose()


@pytest_asyncio.fixture
async def client_factory():
    clients: list[AsyncClient] = []

    async def make_client() -> AsyncClient:
        client = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        clients.append(client)
        return client

    yield make_client

    for client in clients:
        await client.aclose()


@pytest_asyncio.fixture
async def client(client_factory):
    yield await client_factory()


@pytest.fixture
def sync_client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def sync_client_factory():
    clients: list[TestClient] = []

    def make_client() -> TestClient:
        client = TestClient(app)
        client.__enter__()
        clients.append(client)
        return client

    yield make_client

    for client in clients:
        client.__exit__(None, None, None)
