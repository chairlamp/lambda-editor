import asyncio
import json

from starlette.websockets import WebSocketDisconnect

from app.api import auth as auth_module
from app.database import AsyncSessionLocal
from app.websocket.projects import handle_project_room
from app.websocket.rooms import handle_room


async def _register(client, email: str, username: str):
    response = await client.post(
        "/users",
        json={"email": email, "username": username, "password": "pw12345"},
    )
    assert response.status_code == 201
    return response.json()["user"]


async def _create_project(client, title: str = "Realtime Project"):
    response = await client.post("/projects", json={"title": title})
    assert response.status_code == 201
    return response.json()


async def _add_member(client, project_id: str, username_or_email: str, role: str):
    response = await client.post(
        f"/projects/{project_id}/members",
        json={"username_or_email": username_or_email, "role": role},
    )
    assert response.status_code == 201
    return response.json()


class _Disconnect:
    def __init__(self, code: int = 1000):
        self.code = code


class FakeWebSocket:
    def __init__(self):
        self.accepted = False
        self.closed_code = None
        self.closed_reason = None
        self._incoming: asyncio.Queue[object] = asyncio.Queue()
        self._outgoing: asyncio.Queue[dict] = asyncio.Queue()

    async def accept(self):
        self.accepted = True

    async def close(self, code: int = 1000, reason: str | None = None):
        self.closed_code = code
        self.closed_reason = reason
        raise WebSocketDisconnect(code)

    async def receive_text(self) -> str:
        item = await self._incoming.get()
        if isinstance(item, _Disconnect):
            raise WebSocketDisconnect(item.code)
        return str(item)

    async def send_text(self, data: str):
        await self._outgoing.put(json.loads(data))

    async def send_from_client(self, data: str):
        await self._incoming.put(data)

    async def disconnect(self, code: int = 1000):
        await self._incoming.put(_Disconnect(code))

    async def next_json(self) -> dict:
        return await asyncio.wait_for(self._outgoing.get(), timeout=2.0)


async def test_websocket_cookie_auth_accepts_valid_access_tokens(client):
    user = await _register(client, "member@example.com", "member")

    access_token = auth_module._encode_token(  # noqa: SLF001
        user_id=user["id"],
        token_type=auth_module.ACCESS_TOKEN_TYPE,
        ttl_seconds=60,
    )

    assert await auth_module.get_authenticated_user_id_from_cookies(access_token, None) == user["id"]
    assert await auth_module.get_authenticated_user_id_from_cookies(None, None) is None


async def test_project_websocket_replies_to_ping_for_authenticated_members(client):
    user = await _register(client, "member2@example.com", "member2")
    project = await _create_project(client)

    websocket = FakeWebSocket()
    async with AsyncSessionLocal() as db:
        task = asyncio.create_task(handle_project_room(websocket, project["id"], user["id"], user["username"], db))
        try:
            assert await websocket.next_json() == {"type": "connected", "project_id": project["id"]}
            await websocket.send_from_client("ping")
            assert await websocket.next_json() == {"type": "pong"}
            await websocket.disconnect()
            await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)


async def test_document_websocket_broadcasts_basic_cursor_updates(client_factory):
    owner = await client_factory()
    editor = await client_factory()

    owner_user = await _register(owner, "owner@example.com", "owner")
    project = await _create_project(owner, "Cursor Sync")
    editor_user = await _register(editor, "editor@example.com", "editor")
    await _add_member(owner, project["id"], "editor", "editor")

    owner_ws = FakeWebSocket()
    editor_ws = FakeWebSocket()

    async with AsyncSessionLocal() as owner_db, AsyncSessionLocal() as editor_db:
        owner_task = asyncio.create_task(
            handle_room(owner_ws, project["main_doc_id"], owner_user["id"], owner_user["username"], owner_db)
        )
        editor_task = asyncio.create_task(
            handle_room(editor_ws, project["main_doc_id"], editor_user["id"], editor_user["username"], editor_db)
        )

        try:
            owner_init = await owner_ws.next_json()
            assert owner_init["type"] == "init"
            assert owner_init["read_only"] is False

            editor_init = await editor_ws.next_json()
            assert editor_init["type"] == "init"
            assert editor_init["read_only"] is False

            owner_presence = await owner_ws.next_json()
            assert owner_presence["type"] == "presence"

            await owner_ws.send_from_client(
                json.dumps(
                    {
                        "type": "cursor",
                        "position": {"lineNumber": 4, "column": 9},
                        "selection": {
                            "startLineNumber": 4,
                            "startColumn": 1,
                            "endLineNumber": 4,
                            "endColumn": 9,
                        },
                    }
                )
            )

            cursor_message = await editor_ws.next_json()
            while cursor_message["type"] != "cursor":
                cursor_message = await editor_ws.next_json()
            assert cursor_message["type"] == "cursor"
            assert cursor_message["user_id"] == owner_user["id"]
            assert cursor_message["username"] == "owner"
            assert cursor_message["position"] == {"lineNumber": 4, "column": 9}
            assert cursor_message["selection"]["endColumn"] == 9

            await owner_ws.disconnect()
            await editor_ws.disconnect()
            await asyncio.gather(owner_task, editor_task)
        finally:
            for task in (owner_task, editor_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(owner_task, editor_task, return_exceptions=True)
