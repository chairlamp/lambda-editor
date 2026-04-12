import os
import sys
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["REDIS_URL"] = "redis://localhost:6379/0"
os.environ["OPENAI_API_KEY"] = "test"
os.environ["SECRET_KEY"] = "test"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
import pytest_asyncio
import fakeredis.aioredis
from httpx import ASGITransport, AsyncClient

import app.redis_client as redis_module

# Re-bind references that imported redis_client at module load.
import app.api.auth as auth_module

from app.database import Base, engine
from fastapi import FastAPI
from app.api import auth, projects, documents, versions

app = FastAPI()
app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(documents.router)
app.include_router(versions.router)


@pytest_asyncio.fixture(autouse=True)
async def _reset_db():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=True)
    redis_module.redis_client = fake
    auth_module.redis_client = fake

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    await fake.flushall()
    yield
    await fake.aclose()


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
