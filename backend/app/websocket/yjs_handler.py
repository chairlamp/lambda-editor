"""
Clients use `WebsocketProvider` from the `y-websocket` npm package to connect
to /ws/{doc_id}/sync. Server keeps a per-process working Doc for connected
clients, while Redis stores the active CRDT state and fans out updates across
backend instances. PostgreSQL remains the durable snapshot/version store.

Why the adapter is shaped this way:

    1. connect / recover
       browser
         |
         | websocket -> STEP1(state vector)
         v
       FastAPI room Doc ---------------------> Redis full CRDT state
         |                                         ^
         | STEP2(missing diff)                     |
         '-----------------------------------------'

       The room answers with only the missing diff so reconnects stay cheap.
       Redis holds the latest merged CRDT state so any backend instance can
       rebuild the room even after another instance handled the last edits.

    2. edit on this instance
       browser edit
         |
         v
       room Doc apply_update()
         |
         +--> local websocket broadcast         why: nearby collaborators should
         |                                         see changes immediately
         |
         +--> Redis state merge                why: the next reconnect needs the
         |                                         latest CRDT state, not a stale snapshot
         |
         +--> Redis pub/sub                    why: sibling backend instances must
         |                                         replay the same update into their rooms
         |
         '-> delayed PostgreSQL save           why: versions and cold starts need
                                                   durable text, but not on every keystroke

    3. edit on another instance
       sibling instance -> Redis pub/sub -> this room Doc -> local websocket broadcast

       Pub/sub is the cross-instance bridge, so each process can keep an in-memory
       room for speed without diverging from the others.

The room Doc is the fast coordination layer. Redis keeps instances converged and
reconnectable. PostgreSQL keeps the durable document history the CRDT layer alone
does not provide.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from contextlib import suppress
from typing import Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect
from pycrdt import Doc, Text, get_state, merge_updates
from redis.exceptions import WatchError
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.document import Document
from app.models.project import ProjectMember
from app.redis_client import redis_client
from app.websocket.manager import manager

logger = logging.getLogger(__name__)

def _enc_vu(n: int) -> bytes:
    buf = []
    while n > 127:
        buf.append((n & 0x7F) | 0x80)
        n >>= 7
    buf.append(n & 0x7F)
    return bytes(buf)


def _dec_vu(data: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        b = data[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        shift += 7
        if b < 0x80:
            return result, pos


def _read_blob(data: bytes, pos: int) -> tuple[bytes, int]:
    n, pos = _dec_vu(data, pos)
    return data[pos: pos + n], pos + n

_SYNC = 0
_AWARENESS = 1
_STEP1 = 0
_STEP2 = 1
_UPDATE = 2
_INSTANCE_ID = uuid.uuid4().hex


def _b64encode(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64decode(data: Optional[str]) -> Optional[bytes]:
    if not data:
        return None
    return base64.b64decode(data.encode("ascii"))


def _content_fingerprint(content: str) -> dict[str, object]:
    encoded = content.encode("utf-8")
    hash_value = 0x811C9DC5
    for byte in encoded:
        hash_value ^= byte
        hash_value = (hash_value * 0x01000193) & 0xFFFFFFFF
    return {
        "content_hash": f"{hash_value:08x}",
        "content_length": len(encoded),
    }


def _msg_step1(sv: bytes) -> bytes:
    return bytes([_SYNC, _STEP1]) + _enc_vu(len(sv)) + sv


def _msg_step2(diff: bytes) -> bytes:
    return bytes([_SYNC, _STEP2]) + _enc_vu(len(diff)) + diff


def _msg_update(upd: bytes) -> bytes:
    return bytes([_SYNC, _UPDATE]) + _enc_vu(len(upd)) + upd

class _Room:
    def __init__(self, doc_id: str, initial_content: str) -> None:
        self.doc_id = doc_id
        self.ydoc = Doc()
        self._clients: Dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()
        self._init_lock = asyncio.Lock()
        self._save_task: Optional[asyncio.Task] = None
        self._pubsub = None
        self._listener_task: Optional[asyncio.Task] = None
        self._initialized = False
        self._initial_content = initial_content
        self.ydoc["content"] = Text()

    @property
    def _update_key(self) -> str:
        return f"yjs:doc:{self.doc_id}:update"

    @property
    def _channel(self) -> str:
        return f"yjs:doc:{self.doc_id}:updates"

    def _text(self) -> Text:
        return self.ydoc.get("content", type=Text)

    def _state_vector(self) -> bytes:
        return get_state(self.ydoc.get_update())

    async def initialize(self) -> None:
        async with self._init_lock:
            if self._initialized:
                return

            cached = _b64decode(await redis_client.get(self._update_key))
            if cached:
                self.ydoc.apply_update(cached)
            else:
                if self._initial_content:
                    text = self._text()
                    with self.ydoc.transaction():
                        text.clear()
                        text += self._initial_content
                await self._write_full_state_to_redis()

            self._initialized = True

    def get_text(self) -> str:
        return str(self._text())

    async def replace_content(self, new_content: str) -> None:
        """Replace all document text and broadcast the delta to every client."""
        ytext = self._text()
        old_sv = self._state_vector()
        with self.ydoc.transaction():
            ytext.clear()
            if new_content:
                ytext += new_content
        delta = self.ydoc.get_update(old_sv)
        await self._write_full_state_to_redis()
        await self._publish_update(delta)
        await self._broadcast(_msg_update(delta))

    async def add(self, cid: str, ws: WebSocket) -> None:
        async with self._lock:
            self._clients[cid] = ws
            await self._ensure_listener()

    async def remove(self, cid: str) -> None:
        async with self._lock:
            self._clients.pop(cid, None)

    @property
    def empty(self) -> bool:
        return not self._clients

    async def _broadcast(self, msg: bytes, exclude: Optional[str] = None) -> None:
        dead: list[str] = []
        for cid, ws in list(self._clients.items()):
            if cid == exclude:
                continue
            try:
                await ws.send_bytes(msg)
            except Exception:
                dead.append(cid)
        for cid in dead:
            await self.remove(cid)

    async def _ensure_listener(self) -> None:
        if self._listener_task and not self._listener_task.done():
            return
        self._pubsub = redis_client.pubsub()
        await self._pubsub.subscribe(self._channel)
        self._listener_task = asyncio.create_task(self._listen())

    async def _listen(self) -> None:
        assert self._pubsub is not None
        try:
            async for message in self._pubsub.listen():
                if message.get("type") != "message":
                    continue
                try:
                    payload = json.loads(message["data"])
                    if payload.get("sender") == _INSTANCE_ID:
                        continue
                    update = _b64decode(payload.get("update"))
                    if not update:
                        continue
                except Exception:
                    continue
                try:
                    self.ydoc.apply_update(update)
                except Exception:
                    continue
                await self._broadcast(_msg_update(update))
        except asyncio.CancelledError:
            raise
        except Exception:
            pass

    async def close(self) -> None:
        if self._listener_task:
            self._listener_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._listener_task
            self._listener_task = None
        if self._pubsub:
            await self._pubsub.unsubscribe(self._channel)
            await self._pubsub.aclose()
            self._pubsub = None

    async def _write_full_state_to_redis(self) -> None:
        await redis_client.set(self._update_key, _b64encode(self.ydoc.get_update()))

    async def _merge_update_into_redis(self, update: bytes) -> None:
        for _ in range(5):
            try:
                async with redis_client.pipeline(transaction=True) as pipe:
                    await pipe.watch(self._update_key)
                    current = _b64decode(await pipe.get(self._update_key))
                    merged = merge_updates(current, update) if current else update
                    pipe.multi()
                    pipe.set(self._update_key, _b64encode(merged))
                    await pipe.execute()
                    return
            except WatchError:
                continue
            except Exception:
                break
        await self._write_full_state_to_redis()

    async def _publish_update(self, update: bytes) -> None:
        await redis_client.publish(
            self._channel,
            json.dumps({"sender": _INSTANCE_ID, "update": _b64encode(update)}),
        )

    async def apply_client_update(self, update: bytes, exclude_user_id: Optional[str] = None) -> bool:
        try:
            self.ydoc.apply_update(update)
        except Exception:
            return False
        await self._merge_update_into_redis(update)
        await self._publish_update(update)
        await self.schedule_save()
        await self._broadcast(_msg_update(update), exclude=exclude_user_id)
        return True

    async def schedule_save(self) -> None:
        if self._save_task and not self._save_task.done():
            self._save_task.cancel()
            try:
                await self._save_task
            except asyncio.CancelledError:
                pass

        async def _do() -> None:
            await asyncio.sleep(2.0)
            await self._persist()

        self._save_task = asyncio.create_task(_do())

    async def _persist(self) -> None:
        content = self.get_text()
        try:
            async with AsyncSessionLocal() as db:
                res = await db.execute(
                    select(Document).where(Document.id == self.doc_id)
                )
                doc = res.scalar_one_or_none()
                if doc:
                    doc.content = content
                    doc.content_revision += 1
                    await db.commit()
                    await db.refresh(doc)
                    await manager.broadcast_to_room(
                        self.doc_id,
                        {
                            "type": "save_status",
                            "status": "saved",
                            "content_revision": doc.content_revision,
                            "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
                            **_content_fingerprint(content),
                        },
                    )
                    await manager.broadcast_to_room(
                        f"project:{doc.project_id}",
                        {
                            "type": "document_updated",
                            "document": {
                                "id": doc.id,
                                "title": doc.title,
                                "path": doc.path,
                                "kind": doc.kind,
                                "owner_id": doc.owner_id,
                                "project_id": doc.project_id,
                                "source_filename": doc.source_filename,
                                "mime_type": doc.mime_type,
                                "file_size": doc.file_size,
                                "content_revision": doc.content_revision,
                                "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
                            },
                        },
                    )
                    return
        except Exception:
            logger.exception("Failed to persist Yjs document %s", self.doc_id)

        await manager.broadcast_to_room(
            self.doc_id,
            {
                "type": "save_status",
                "status": "error",
                "error": "Could not persist document changes.",
                **_content_fingerprint(content),
            },
        )


_rooms: Dict[str, _Room] = {}
_registry_lock = asyncio.Lock()


async def _get_room(doc_id: str, initial_content: str) -> _Room:
    async with _registry_lock:
        if doc_id not in _rooms:
            _rooms[doc_id] = _Room(doc_id, initial_content)
        room = _rooms[doc_id]
    await room.initialize()
    return room


async def _replace_doc_state_in_redis(doc_id: str, new_content: str) -> bytes:
    update_key = f"yjs:doc:{doc_id}:update"
    current = _b64decode(await redis_client.get(update_key))

    doc = Doc()
    doc["content"] = Text()
    if current:
        doc.apply_update(current)

    old_sv = get_state(doc.get_update())
    with doc.transaction():
        text = doc.get("content", type=Text)
        text.clear()
        if new_content:
            text += new_content

    full_state = doc.get_update()
    delta = doc.get_update(old_sv)
    await redis_client.set(update_key, _b64encode(full_state))
    await redis_client.publish(
        f"yjs:doc:{doc_id}:updates",
        json.dumps({"sender": _INSTANCE_ID, "update": _b64encode(delta)}),
    )
    return delta


async def invalidate_room(doc_id: str, new_content: str) -> None:
    """Push version-restored content to all currently connected clients."""
    async with _registry_lock:
        room = _rooms.get(doc_id)
    if room:
        await room.replace_content(new_content)
        return
    await _replace_doc_state_in_redis(doc_id, new_content)


async def _release(doc_id: str) -> None:
    async with _registry_lock:
        room = _rooms.get(doc_id)
        if room and room.empty:
            if room._save_task and not room._save_task.done():
                room._save_task.cancel()
            await room._persist()
            await room.close()
            del _rooms[doc_id]

async def handle_yjs_room(websocket: WebSocket, doc_id: str, user_id: str) -> None:
    await websocket.accept()

    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Document).where(Document.id == doc_id))
        doc = res.scalar_one_or_none()
        if not doc:
            await websocket.close(code=4004, reason="Document not found")
            return

        mem = await db.execute(
            select(ProjectMember).where(
                ProjectMember.project_id == doc.project_id,
                ProjectMember.user_id == user_id,
            )
        )
        membership = mem.scalar_one_or_none()
        if not membership:
            await websocket.close(code=4003, reason="Not a project member")
            return

        read_only = membership.role == "viewer"
        initial_content = doc.content or ""

    room = await _get_room(doc_id, initial_content)
    await room.add(user_id, websocket)

    # Start with the state vector so the client only sends the delta we do not already have.
    sv = room._state_vector()
    await websocket.send_bytes(_msg_step1(sv))

    try:
        while True:
            try:
                data = await websocket.receive_bytes()
            except (WebSocketDisconnect, Exception):
                break

            if len(data) < 2:
                continue

            msg_type = data[0]

            if msg_type == _SYNC:
                sync_type = data[1]
                try:
                    payload, _ = _read_blob(data, 2)
                except Exception:
                    continue

                if sync_type == _STEP1:
                    # Reply with only the missing update so reconnects do not resend full documents.
                    try:
                        diff = room.ydoc.get_update(payload)
                        await websocket.send_bytes(_msg_step2(diff))
                    except Exception:
                        pass

                elif sync_type in (_STEP2, _UPDATE):
                    if not read_only:
                        applied = await room.apply_client_update(payload, exclude_user_id=user_id)
                        if not applied:
                            continue

            elif msg_type == _AWARENESS:
                # Forward awareness untouched so cursor presence stays compatible with y-websocket clients.
                await room._broadcast(data, exclude=user_id)

    except Exception:
        pass
    finally:
        await room.remove(user_id)
        await _release(doc_id)
