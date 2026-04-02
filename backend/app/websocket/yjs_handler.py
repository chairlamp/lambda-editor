"""
Yjs CRDT sync — binary y-websocket protocol served directly by FastAPI.

Clients use `WebsocketProvider` from the `y-websocket` npm package to connect
to /ws/{doc_id}/sync.  Server maintains an authoritative Y.Doc per document,
debounces DB saves, and supports version-restore via `invalidate_room`.
"""
from __future__ import annotations

import asyncio
from typing import Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect
from pycrdt import Doc, Text, get_state
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.document import Document
from app.models.project import ProjectMember


# ── lib0 variable-length uint helpers ────────────────────────────────────────


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


# ── y-websocket message type constants ───────────────────────────────────────

_SYNC = 0
_AWARENESS = 1
_STEP1 = 0
_STEP2 = 1
_UPDATE = 2


def _msg_step1(sv: bytes) -> bytes:
    return bytes([_SYNC, _STEP1]) + _enc_vu(len(sv)) + sv


def _msg_step2(diff: bytes) -> bytes:
    return bytes([_SYNC, _STEP2]) + _enc_vu(len(diff)) + diff


def _msg_update(upd: bytes) -> bytes:
    return bytes([_SYNC, _UPDATE]) + _enc_vu(len(upd)) + upd


# ── Room ─────────────────────────────────────────────────────────────────────


class _Room:
    def __init__(self, doc_id: str, initial_content: str) -> None:
        self.doc_id = doc_id
        self.ydoc = Doc()
        self._clients: Dict[str, WebSocket] = {}
        self._lock = asyncio.Lock()
        self._save_task: Optional[asyncio.Task] = None

        self.ydoc["content"] = Text(initial_content)

    def _text(self) -> Text:
        return self.ydoc.get("content", type=Text)

    def _state_vector(self) -> bytes:
        return get_state(self.ydoc.get_update())

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
        await self._broadcast(_msg_update(delta))

    async def add(self, cid: str, ws: WebSocket) -> None:
        async with self._lock:
            self._clients[cid] = ws

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
        except Exception:
            pass


# ── Room registry ─────────────────────────────────────────────────────────────

_rooms: Dict[str, _Room] = {}
_registry_lock = asyncio.Lock()


async def _get_room(doc_id: str, initial_content: str) -> _Room:
    async with _registry_lock:
        if doc_id not in _rooms:
            _rooms[doc_id] = _Room(doc_id, initial_content)
        return _rooms[doc_id]


async def invalidate_room(doc_id: str, new_content: str) -> None:
    """Push version-restored content to all currently connected clients."""
    async with _registry_lock:
        room = _rooms.get(doc_id)
    if room:
        await room.replace_content(new_content)


async def _release(doc_id: str) -> None:
    async with _registry_lock:
        room = _rooms.get(doc_id)
        if room and room.empty:
            if room._save_task and not room._save_task.done():
                room._save_task.cancel()
            await room._persist()
            del _rooms[doc_id]


# ── WebSocket handler ─────────────────────────────────────────────────────────


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

    # Kick off sync: send our state vector so the client can send us what we're missing
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
                    # Client sent its state vector; reply with everything it's missing
                    try:
                        diff = room.ydoc.get_update(payload)
                        await websocket.send_bytes(_msg_step2(diff))
                    except Exception:
                        pass

                elif sync_type in (_STEP2, _UPDATE):
                    if not read_only:
                        try:
                            room.ydoc.apply_update(payload)
                        except Exception:
                            continue
                        await room.schedule_save()
                        await room._broadcast(_msg_update(payload), exclude=user_id)

            elif msg_type == _AWARENESS:
                # Forward awareness (remote cursors) unchanged to all other clients
                await room._broadcast(data, exclude=user_id)

    except Exception:
        pass
    finally:
        await room.remove(user_id)
        await _release(doc_id)
