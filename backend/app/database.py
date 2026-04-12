from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.config import settings
from pathlib import Path


def _normalize_database_url(database_url: str) -> str:
    if database_url.startswith("postgres://"):
        return f"postgresql+asyncpg://{database_url[len('postgres://'):]}"
    if database_url.startswith("postgresql://") and "+asyncpg" not in database_url:
        return f"postgresql+asyncpg://{database_url[len('postgresql://'):]}"
    return database_url


engine = create_async_engine(_normalize_database_url(settings.DATABASE_URL), echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    Path(settings.UPLOADS_DIR).mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
