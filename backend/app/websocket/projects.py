from __future__ import annotations

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectMember
from app.websocket.manager import manager


async def handle_project_room(
    websocket: WebSocket,
    project_id: str,
    user_id: str,
    username: str,
    db: AsyncSession,
):
    await websocket.accept()

    membership = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    member = membership.scalar_one_or_none()
    if not member:
        await websocket.close(code=4003, reason="Not a project member")
        return

    room_id = f"project:{project_id}"
    room = await manager.get_or_create_room(room_id)
    await room.add(user_id, username, websocket)

    try:
        await room.send_to(user_id, {"type": "connected", "project_id": project_id})
        while True:
            raw = await websocket.receive_text()
            if not raw:
                continue
            msg = raw.strip()
            if msg == "ping":
                await room.send_to(user_id, {"type": "pong"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        await room.remove(user_id)
        await manager.cleanup_room(room_id)
