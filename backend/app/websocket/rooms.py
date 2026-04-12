from __future__ import annotations
import json
from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.websocket.manager import manager, _user_color
from app.models.ai_chat import AIChatMessage
from app.models.document import Document
from app.models.project import ProjectMember


async def handle_room(
    websocket: WebSocket,
    doc_id: str,
    user_id: str,
    username: str,
    db: AsyncSession,
):
    await websocket.accept()

    result = await db.execute(select(Document).where(Document.id == doc_id))
    doc = result.scalar_one_or_none()
    if not doc:
        await websocket.close(code=4004, reason="Document not found")
        return

    mem_res = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == doc.project_id,
            ProjectMember.user_id == user_id,
        )
    )
    membership = mem_res.scalar_one_or_none()
    if not membership:
        await websocket.close(code=4003, reason="Not a project member")
        return

    read_only = membership.role == "viewer"

    room = await manager.get_or_create_room(doc_id)
    await room.add(user_id, username, websocket, doc.content, read_only=read_only)

    await room.send_to(user_id, {
        "type": "init",
        "content": doc.content,
        "revision": doc.content_revision,
        "presence": await room.presence_list(),
        "read_only": read_only,
        "cursors": await room.cursor_snapshot(exclude=user_id),
    })
    await room.broadcast(
        {"type": "presence", "presence": await room.presence_list()},
        exclude=user_id,
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")

            if msg_type == "cursor":
                await room.set_cursor(user_id, msg.get("position"))
                await room.broadcast(
                    {
                        "type": "cursor",
                        "user_id": user_id,
                        "username": username,
                        "color": _user_color(user_id),
                        "position": msg.get("position"),
                        "selection": msg.get("selection"),
                    },
                    exclude=user_id,
                )

            elif msg_type == "ai_chat":
                if read_only:
                    continue
                if msg.get("event") == "user_msg":
                    action_id = msg.get("action_id")
                    if action_id:
                        existing = await db.get(AIChatMessage, action_id)
                        if not existing:
                            db.add(AIChatMessage(
                                id=action_id,
                                document_id=doc.id,
                                user_id=user_id,
                                role="user",
                                content=msg.get("content", "") or "",
                                action_type=msg.get("action_type"),
                                action_prompt=msg.get("action_prompt"),
                                quotes_json=json.dumps(msg.get("quotes")) if msg.get("quotes") is not None else None,
                            ))
                            await db.commit()
                await room.broadcast(
                    {**msg, "user_id": user_id, "username": username},
                    exclude=user_id,
                )

            elif msg_type == "compile_result":
                await room.broadcast(
                    {**msg, "user_id": user_id, "username": username},
                    exclude=user_id,
                )

            elif msg_type == "title":
                if read_only:
                    continue
                doc.title = msg.get("title", doc.title)
                await db.commit()
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
                await room.broadcast(
                    {"type": "title", "title": msg.get("title"), "user_id": user_id},
                    exclude=user_id,
                )

            elif msg_type == "typing":
                if not read_only:
                    await room.broadcast(
                        {
                            "type": "typing",
                            "user_id": user_id,
                            "username": username,
                            "is_typing": bool(msg.get("is_typing", True)),
                        },
                        exclude=user_id,
                    )

            elif msg_type == "ping":
                await room.send_to(user_id, {"type": "pong"})

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await room.remove(user_id)
        await room.broadcast({"type": "presence", "presence": await room.presence_list()})
        await manager.cleanup_room(doc_id)
