from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from typing import Dict, Optional

from fastapi import WebSocket

from app.redis_client import redis_client


class Room:
    def __init__(self, room_id: str):
        self.room_id = room_id
        self.connections: Dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None

    @property
    def _presence_key(self) -> str:
        return f"room:{self.room_id}:presence"

    @property
    def _cursor_key(self) -> str:
        return f"room:{self.room_id}:cursors"

    @property
    def _channel(self) -> str:
        return f"room:{self.room_id}:events"

    async def _ensure_listener(self):
        if self._listener_task and not self._listener_task.done():
            return
        self._pubsub = redis_client.pubsub()
        await self._pubsub.subscribe(self._channel)
        self._listener_task = asyncio.create_task(self._listen())

    async def _listen(self):
        assert self._pubsub is not None
        try:
            async for message in self._pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                except Exception:
                    continue
                exclude = payload.pop("_exclude", None)
                await self._send_local(payload, exclude)
        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    async def add(
        self,
        user_id: str,
        username: str,
        websocket: WebSocket,
        initial_content: str = "",
        read_only: bool = False,
    ):
        async with self._lock:
            self.connections[user_id] = websocket
            await self._ensure_listener()
            await redis_client.hset(
                self._presence_key,
                user_id,
                json.dumps({
                    "user_id": user_id,
                    "username": username,
                    "color": _user_color(user_id),
                    "read_only": read_only,
                }),
            )

    async def remove(self, user_id: str):
        async with self._lock:
            self.connections.pop(user_id, None)
            await redis_client.hdel(self._presence_key, user_id)
            await redis_client.hdel(self._cursor_key, user_id)

    async def set_cursor(self, user_id: str, position: Optional[dict]):
        if position:
            await redis_client.hset(self._cursor_key, user_id, json.dumps(position))
        else:
            await redis_client.hdel(self._cursor_key, user_id)

    async def broadcast(self, message: dict, exclude: Optional[str] = None):
        payload = dict(message)
        payload["_exclude"] = exclude
        await redis_client.publish(self._channel, json.dumps(payload))

    async def _send_local(self, message: dict, exclude: Optional[str] = None):
        data = json.dumps(message)
        dead = []
        for uid, ws in self.connections.items():
            if uid == exclude:
                continue
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(uid)
        for uid in dead:
            await self.remove(uid)

    async def send_to(self, user_id: str, message: dict):
        ws = self.connections.get(user_id)
        if ws:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                await self.remove(user_id)

    async def presence_list(self):
        raw = await redis_client.hgetall(self._presence_key)
        presence = []
        for value in raw.values():
            try:
                presence.append(json.loads(value))
            except Exception:
                continue
        return presence

    async def cursor_snapshot(self, exclude: Optional[str] = None):
        raw_cursors = await redis_client.hgetall(self._cursor_key)
        raw_presence = await redis_client.hgetall(self._presence_key)
        snapshot = {}
        for uid, value in raw_cursors.items():
            if uid == exclude:
                continue
            try:
                position = json.loads(value)
            except Exception:
                continue
            try:
                presence = json.loads(raw_presence.get(uid, "{}"))
            except Exception:
                presence = {}
            snapshot[uid] = {
                "position": position,
                "color": presence.get("color", "#ccc"),
                "username": presence.get("username", ""),
            }
        return snapshot

    @property
    def is_empty(self):
        return len(self.connections) == 0

    async def close(self):
        if self._listener_task:
            self._listener_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._listener_task
            self._listener_task = None
        if self._pubsub:
            await self._pubsub.unsubscribe(self._channel)
            await self._pubsub.aclose()
            self._pubsub = None


class ConnectionManager:
    def __init__(self):
        self.rooms: Dict[str, Room] = {}
        self._lock = asyncio.Lock()

    async def get_or_create_room(self, room_id: str) -> Room:
        async with self._lock:
            if room_id not in self.rooms:
                self.rooms[room_id] = Room(room_id)
            return self.rooms[room_id]

    async def cleanup_room(self, room_id: str):
        async with self._lock:
            room = self.rooms.get(room_id)
            if room and room.is_empty:
                await room.close()
                del self.rooms[room_id]

    async def broadcast_to_room(self, room_id: str, message: dict):
        room = self.rooms.get(room_id)
        if not room:
            await redis_client.publish(f"room:{room_id}:events", json.dumps({**message, "_exclude": None}))
            return
        await room.broadcast(message)
        await self.cleanup_room(room_id)


manager = ConnectionManager()


def _user_color(user_id: str) -> str:
    colors = [
        "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4", "#FFEAA7",
        "#DDA0DD", "#98D8C8", "#F7DC6F", "#BB8FCE", "#85C1E9",
    ]
    idx = sum(ord(c) for c in user_id) % len(colors)
    return colors[idx]
