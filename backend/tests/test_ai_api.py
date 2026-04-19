import asyncio
import json

import pytest

from app.api import ai as ai_module
from app.services import ai_service
from app.services import agent_service
from app.config import settings
from app.services.ai_cancellation import AICancelledError
from app.websocket.manager import manager


async def _register(client, email: str, username: str):
    response = await client.post(
        "/users",
        json={"email": email, "username": username, "password": "pw12345"},
    )
    assert response.status_code == 201
    return response.json()["user"]


async def _create_project(client, title: str = "AI Project"):
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


async def test_streaming_ai_generation_persists_history(client, monkeypatch):
    await _register(client, "owner@example.com", "owner")
    project = await _create_project(client)

    async def fake_generate_text(prompt: str, document_context: str = ""):
        assert prompt == "Summarize this"
        assert document_context == "current"
        yield "Hello"
        yield " world"

    monkeypatch.setattr(ai_service, "generate_text", fake_generate_text)

    async with client.stream(
        "POST",
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/text-generations",
        json={
            "prompt": "Summarize this",
            "document_context": "current",
            "action_id": "act-1",
        },
    ) as response:
        assert response.status_code == 200
        body = ""
        async for chunk in response.aiter_text():
            body += chunk

    assert 'data: "Hello"' in body
    assert 'data: " world"' in body
    assert "data: [DONE]" in body

    history_response = await client.get(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/messages"
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 2

    history_by_id = {message["id"]: message for message in history}
    assert history_by_id["act-1"]["role"] == "user"
    assert history_by_id["act-1"]["content"] == "Summarize this"
    assert history_by_id["act-1"]["action_prompt"] == "Summarize this"
    assert history_by_id["act-1"]["provider"] == settings.llm_provider
    assert history_by_id["act-1"]["model"] == settings.llm_model
    assert history_by_id["act-1"]["status"] == "submitted"

    assert history_by_id["act-1-res"]["role"] == "assistant"
    assert history_by_id["act-1-res"]["content"] == "Hello world"
    assert history_by_id["act-1-res"]["provider"] == settings.llm_provider
    assert history_by_id["act-1-res"]["model"] == settings.llm_model
    assert history_by_id["act-1-res"]["status"] == "completed"


async def test_streaming_agent_chat_persists_history_and_metadata(client, monkeypatch):
    await _register(client, "agent-owner@example.com", "agent-owner")
    project = await _create_project(client, "Agent Stream")

    async def fake_agent_chat(prompt: str, document_context: str = "", result_holder=None):
        assert prompt == "Explain the introduction"
        assert document_context == "current"
        if result_holder is not None:
            result_holder.update({
                "content": "This is a streamed agent response with metadata attached for the chat history view.",
                "sources": [{"title": "Docs", "url": "https://example.com/docs"}],
                "tools_used": ["research_topic"],
            })
        yield "This is a streamed agent response with "
        yield "metadata attached for the chat history view."

    monkeypatch.setattr(agent_service, "stream_tool_enabled_chat", fake_agent_chat)

    async with client.stream(
        "POST",
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/message-streams",
        json={
            "prompt": "Explain the introduction",
            "document_context": "current",
            "action_id": "act-agent-stream",
        },
    ) as response:
        assert response.status_code == 200
        body = ""
        async for chunk in response.aiter_text():
            body += chunk

    assert body.count('data: "') >= 2
    assert "data: [DONE]" in body

    history_response = await client.get(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/messages"
    )
    assert history_response.status_code == 200
    history = history_response.json()
    history_by_id = {message["id"]: message for message in history}

    assert history_by_id["act-agent-stream"]["role"] == "user"
    assert history_by_id["act-agent-stream"]["content"] == "Explain the introduction"
    assert history_by_id["act-agent-stream"]["status"] == "submitted"

    assistant_message = history_by_id["act-agent-stream-res"]
    assert assistant_message["role"] == "assistant"
    assert assistant_message["content"] == "This is a streamed agent response with metadata attached for the chat history view."
    assert assistant_message["sources"] == [{"title": "Docs", "url": "https://example.com/docs"}]
    assert assistant_message["tool_calls"] == ["research_topic"]
    assert assistant_message["provider"] == settings.llm_provider
    assert assistant_message["model"] == settings.llm_model
    assert assistant_message["status"] == "completed"


async def test_ai_diff_history_and_review_state_are_persisted(client_factory, monkeypatch):
    owner = await client_factory()
    viewer = await client_factory()

    await _register(owner, "owner2@example.com", "owner2")
    project = await _create_project(owner, "AI Review")
    await _register(viewer, "viewer@example.com", "viewer")
    await _add_member(owner, project["id"], "viewer", "viewer")

    async def fake_suggest_changes(instruction: str, document_content: str, variation_request: str = ""):
        assert instruction == "Tighten the introduction"
        assert "Introduction" in document_content
        return {
            "explanation": "Suggested one targeted rewrite.",
            "changes": [
                {
                    "id": "c1",
                    "description": "Rewrite the opening line.",
                    "old_text": "Introduction",
                    "new_text": "Overview",
                }
            ],
        }

    monkeypatch.setattr(ai_service, "suggest_changes", fake_suggest_changes)

    doc_response = await owner.get(f"/projects/{project['id']}/documents/{project['main_doc_id']}")
    assert doc_response.status_code == 200

    diff_response = await owner.post(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/change-suggestions",
        json={
            "instruction": "Tighten the introduction",
            "document_content": doc_response.json()["content"],
            "action_id": "act-2",
        },
    )
    assert diff_response.status_code == 200
    assert diff_response.json()["changes"][0]["id"] == "c1"

    review_response = await owner.patch(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/messages/act-2-diff",
        json={"accepted": ["c1"], "rejected": []},
    )
    assert review_response.status_code == 200
    assert review_response.json() == {"ok": True}

    history_response = await owner.get(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/messages"
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 2

    history_by_id = {message["id"]: message for message in history}
    assert history_by_id["act-2"]["role"] == "user"
    assert history_by_id["act-2"]["action_type"] == "suggest"
    assert history_by_id["act-2"]["action_prompt"] == "Tighten the introduction"
    assert history_by_id["act-2"]["provider"] == settings.llm_provider
    assert history_by_id["act-2"]["model"] == settings.llm_model
    assert history_by_id["act-2"]["status"] == "submitted"

    assert history_by_id["act-2-diff"]["diff"]["changes"][0]["new_text"] == "Overview"
    assert history_by_id["act-2-diff"]["accepted"] == ["c1"]
    assert history_by_id["act-2-diff"]["provider"] == settings.llm_provider
    assert history_by_id["act-2-diff"]["model"] == settings.llm_model
    assert history_by_id["act-2-diff"]["status"] == "completed"
    assert history_by_id["act-2-diff"]["retry_action"] == {
        "type": "suggest",
        "instruction": "Tighten the introduction",
    }

    viewer_response = await viewer.post(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/change-suggestions",
        json={
            "instruction": "Viewer should be blocked",
            "document_content": doc_response.json()["content"],
            "action_id": "blocked-act",
        },
    )
    assert viewer_response.status_code == 403


async def _drain(response) -> str:
    body = ""
    async for piece in response.body_iterator:
        body += piece if isinstance(piece, str) else piece.decode()
    return body


class _RoomWebSocket:
    def __init__(self):
        self.messages: asyncio.Queue[dict] = asyncio.Queue()

    async def send_text(self, data: str):
        await self.messages.put(json.loads(data))

    async def next_json(self) -> dict:
        return await asyncio.wait_for(self.messages.get(), timeout=2.0)


async def test_sse_streams_chunks_to_collaborators_without_echoing_initiator():
    room_id = "doc-stream-success"
    initiator_ws = _RoomWebSocket()
    collaborator_ws = _RoomWebSocket()
    room = await manager.get_or_create_room(room_id)
    await room.add("owner", "owner", initiator_ws)
    await room.add("editor", "editor", collaborator_ws)

    async def good_gen():
        yield "Hello"
        yield " world"

    try:
        response = ai_module._sse(
            None,
            good_gen(),
            doc_id=room_id,
            action_id="act-room",
            broadcast_exclude_user_id="owner",
            actor_username="owner",
        )
        body = await _drain(response)

        assert 'data: "Hello"' in body
        assert 'data: " world"' in body
        assert "data: [DONE]" in body

        assert await collaborator_ws.next_json() == {
            "type": "ai_chat",
            "event": "chunk",
            "action_id": "act-room",
            "username": "owner",
            "content": "Hello",
        }
        assert await collaborator_ws.next_json() == {
            "type": "ai_chat",
            "event": "chunk",
            "action_id": "act-room",
            "username": "owner",
            "content": " world",
        }
        assert await collaborator_ws.next_json() == {
            "type": "ai_chat",
            "event": "done",
            "action_id": "act-room",
            "username": "owner",
            "status": "completed",
        }
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(initiator_ws.next_json(), timeout=0.05)
    finally:
        await room.remove("owner")
        await room.remove("editor")
        await manager.cleanup_room(room_id)


async def test_sse_error_emits_explicit_event_frame_and_skips_on_complete():
    """Provider failures mid-stream must surface as an SSE error event, and
    ``on_complete`` must not run so partial output is never persisted."""

    async def bad_gen():
        yield "Hello"
        raise RuntimeError("boom")

    completions: list[str] = []

    async def on_complete(content: str) -> None:
        completions.append(content)

    response = ai_module._sse(None, bad_gen(), on_complete=on_complete)
    body = await _drain(response)

    assert 'data: "Hello"' in body
    assert "event: error" in body
    assert "boom" in body
    assert "data: [DONE]" in body
    assert completions == []


async def test_sse_error_notifies_collaborators_with_failed_done_event():
    room_id = "doc-stream-error"
    initiator_ws = _RoomWebSocket()
    collaborator_ws = _RoomWebSocket()
    room = await manager.get_or_create_room(room_id)
    await room.add("owner", "owner", initiator_ws)
    await room.add("editor", "editor", collaborator_ws)

    async def bad_gen():
        yield "Hello"
        raise RuntimeError("boom")

    try:
        response = ai_module._sse(
            None,
            bad_gen(),
            doc_id=room_id,
            action_id="act-error",
            broadcast_exclude_user_id="owner",
            actor_username="owner",
        )
        body = await _drain(response)

        assert 'data: "Hello"' in body
        assert "event: error" in body
        assert "boom" in body

        assert await collaborator_ws.next_json() == {
            "type": "ai_chat",
            "event": "chunk",
            "action_id": "act-error",
            "username": "owner",
            "content": "Hello",
        }
        assert await collaborator_ws.next_json() == {
            "type": "ai_chat",
            "event": "done",
            "action_id": "act-error",
            "username": "owner",
            "status": "failed",
            "error": "boom",
        }
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(initiator_ws.next_json(), timeout=0.05)
    finally:
        await room.remove("owner")
        await room.remove("editor")
        await manager.cleanup_room(room_id)


async def test_sse_client_disconnect_cancels_stream_without_persisting():
    """A client disconnect cancels the generator task; partial chunks must
    not reach ``on_complete`` because history is only persisted on success."""

    gate = asyncio.Event()  # never set — forces the generator to suspend
    room_id = "doc-stream-cancel"
    initiator_ws = _RoomWebSocket()
    collaborator_ws = _RoomWebSocket()
    room = await manager.get_or_create_room(room_id)
    await room.add("owner", "owner", initiator_ws)
    await room.add("editor", "editor", collaborator_ws)

    async def slow_gen():
        yield "Hello"
        await gate.wait()
        yield " world"

    completions: list[str] = []

    async def on_complete(content: str) -> None:
        completions.append(content)

    try:
        response = ai_module._sse(
            None,
            slow_gen(),
            on_complete=on_complete,
            doc_id=room_id,
            action_id="act-cancel",
            broadcast_exclude_user_id="owner",
            actor_username="owner",
        )
        it = response.body_iterator.__aiter__()

        # Pull the open-comment and the first chunk so the generator is suspended
        # inside _with_heartbeats, waiting for the next token from slow_gen.
        open_frame = await it.__anext__()
        first_chunk = await it.__anext__()
        assert ": open" in (open_frame if isinstance(open_frame, str) else open_frame.decode())
        assert 'data: "Hello"' in (first_chunk if isinstance(first_chunk, str) else first_chunk.decode())

        assert await collaborator_ws.next_json() == {
            "type": "ai_chat",
            "event": "chunk",
            "action_id": "act-cancel",
            "username": "owner",
            "content": "Hello",
        }

        # Simulate the client going away: cancel the pending __anext__.
        pending = asyncio.create_task(it.__anext__())
        await asyncio.sleep(0)
        pending.cancel()
        with pytest.raises((asyncio.CancelledError, StopAsyncIteration)):
            await pending

        assert await collaborator_ws.next_json() == {
            "type": "ai_chat",
            "event": "cancelled",
            "action_id": "act-cancel",
            "username": "owner",
            "response_kind": "res",
            "status": "cancelled",
            "error": "Cancelled by user",
        }
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(initiator_ws.next_json(), timeout=0.05)

        assert completions == []
    finally:
        await room.remove("owner")
        await room.remove("editor")
        await manager.cleanup_room(room_id)


async def test_failed_ai_diff_is_persisted_with_error_metadata(client, monkeypatch):
    await _register(client, "owner3@example.com", "owner3")
    project = await _create_project(client, "AI Failure")

    async def failing_suggest_changes(instruction: str, document_content: str, variation_request: str = ""):
        raise RuntimeError("LLM temporarily unavailable")

    monkeypatch.setattr(ai_service, "suggest_changes", failing_suggest_changes)

    doc_response = await client.get(f"/projects/{project['id']}/documents/{project['main_doc_id']}")
    assert doc_response.status_code == 200

    diff_response = await client.post(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/change-suggestions",
        json={
            "instruction": "Try a failing edit",
            "document_content": doc_response.json()["content"],
            "action_id": "act-fail",
        },
    )
    assert diff_response.status_code == 503
    assert diff_response.json()["detail"] == "LLM temporarily unavailable"

    history_response = await client.get(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/messages"
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 2

    history_by_id = {message["id"]: message for message in history}
    assert history_by_id["act-fail"]["role"] == "user"
    assert history_by_id["act-fail"]["status"] == "submitted"
    assert history_by_id["act-fail"]["provider"] == settings.llm_provider
    assert history_by_id["act-fail"]["model"] == settings.llm_model

    failed_message = history_by_id["act-fail-diff"]
    assert failed_message["role"] == "assistant"
    assert failed_message["status"] == "failed"
    assert failed_message["error"] == "LLM temporarily unavailable"
    assert failed_message["provider"] == settings.llm_provider
    assert failed_message["model"] == settings.llm_model
    assert failed_message["retry_action"] == {
        "type": "suggest",
        "instruction": "Try a failing edit",
    }
    assert failed_message["diff"]["changes"] == []
    assert failed_message["diff"]["explanation"] == "LLM temporarily unavailable"


async def test_cancelled_ai_diff_is_persisted_with_cancelled_status(client, monkeypatch):
    await _register(client, "owner4@example.com", "owner4")
    project = await _create_project(client, "AI Cancel")

    async def cancelled_request(_request, _action_id, awaitable):
        awaitable.close()
        raise AICancelledError("Cancelled by user")

    monkeypatch.setattr(ai_module, "run_cancellable_request", cancelled_request)

    doc_response = await client.get(f"/projects/{project['id']}/documents/{project['main_doc_id']}")
    assert doc_response.status_code == 200

    diff_response = await client.post(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/change-suggestions",
        json={
            "instruction": "Cancel this edit",
            "document_content": doc_response.json()["content"],
            "action_id": "act-cancel",
        },
    )
    assert diff_response.status_code == 499
    assert diff_response.json()["detail"] == "Request cancelled"

    history_response = await client.get(
        f"/projects/{project['id']}/documents/{project['main_doc_id']}/ai/messages"
    )
    assert history_response.status_code == 200
    history = history_response.json()
    assert len(history) == 2

    history_by_id = {message["id"]: message for message in history}
    assert history_by_id["act-cancel"]["status"] == "cancelled"
    assert history_by_id["act-cancel"]["error"] == "Cancelled by user"
    assert history_by_id["act-cancel-diff"]["status"] == "cancelled"
    assert history_by_id["act-cancel-diff"]["error"] == "Cancelled by user"
    assert history_by_id["act-cancel-diff"]["diff"]["explanation"] == "Cancelled by user"
    assert history_by_id["act-cancel-diff"]["retry_action"] == {
        "type": "suggest",
        "instruction": "Cancel this edit",
    }
