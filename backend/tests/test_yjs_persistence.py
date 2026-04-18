from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models.document import Document
import app.websocket.yjs_handler as yjs_handler


async def _register(client, email: str, username: str):
    response = await client.post(
        "/users",
        json={"email": email, "username": username, "password": "pw12345"},
    )
    assert response.status_code == 201
    return response.json()["user"]


async def _create_project(client, title: str = "Persistence Project"):
    response = await client.post("/projects", json={"title": title})
    assert response.status_code == 201
    return response.json()


async def test_yjs_persist_broadcasts_confirmed_save_state(client, monkeypatch):
    await _register(client, "persist@example.com", "persist")
    project = await _create_project(client)
    doc_id = project["main_doc_id"]
    persisted_content = "\\section{Saved}\nHello world"
    broadcasts: list[tuple[str, dict]] = []

    async def capture(room_id: str, message: dict):
        broadcasts.append((room_id, message))

    monkeypatch.setattr(yjs_handler.manager, "broadcast_to_room", capture)

    room = yjs_handler._Room(doc_id, "")  # noqa: SLF001
    with room.ydoc.transaction():
        text = room._text()  # noqa: SLF001
        text += persisted_content

    await room._persist()  # noqa: SLF001

    save_events = [message for room_id, message in broadcasts if room_id == doc_id and message["type"] == "save_status"]
    assert len(save_events) == 1
    assert save_events[0]["status"] == "saved"
    assert save_events[0]["content_hash"] == "50603c8f"
    assert save_events[0]["content_length"] == len(persisted_content.encode("utf-8"))
    assert save_events[0]["content_revision"] == 1
    assert isinstance(save_events[0]["updated_at"], str)

    project_events = [message for room_id, message in broadcasts if room_id == f"project:{project['id']}"]
    assert any(message["type"] == "document_updated" for message in project_events)

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Document).where(Document.id == doc_id))
        doc = result.scalar_one()
        assert doc.content == persisted_content
        assert doc.content_revision == 1


class _BrokenSession:
    async def __aenter__(self):
        raise RuntimeError("db down")

    async def __aexit__(self, exc_type, exc, tb):
        return False


async def test_yjs_persist_broadcasts_failure_state_when_database_write_fails(monkeypatch):
    broadcasts: list[tuple[str, dict]] = []

    async def capture(room_id: str, message: dict):
        broadcasts.append((room_id, message))

    monkeypatch.setattr(yjs_handler.manager, "broadcast_to_room", capture)
    monkeypatch.setattr(yjs_handler, "AsyncSessionLocal", lambda: _BrokenSession())

    room = yjs_handler._Room("doc-save-error", "")  # noqa: SLF001
    with room.ydoc.transaction():
        text = room._text()  # noqa: SLF001
        text += "Broken save"

    await room._persist()  # noqa: SLF001

    assert broadcasts == [
        (
            "doc-save-error",
            {
                "type": "save_status",
                "status": "error",
                "error": "Could not persist document changes.",
                **yjs_handler._content_fingerprint("Broken save"),  # noqa: SLF001
            },
        )
    ]
