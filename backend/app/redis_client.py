from __future__ import annotations

from app.config import settings

if settings.USE_FAKE_REDIS:
    import fakeredis.aioredis

    redis_client = fakeredis.aioredis.FakeRedis(decode_responses=True)
else:
    from redis.asyncio import Redis

    redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
