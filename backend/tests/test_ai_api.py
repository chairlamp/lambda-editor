from app.services import ai_service


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
    assert len(history) == 1
    assert history[0]["id"] == "act-1-res"
    assert history[0]["role"] == "assistant"
    assert history[0]["content"] == "Hello world"


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
    assert len(history) == 1
    assert history[0]["id"] == "act-2-diff"
    assert history[0]["diff"]["changes"][0]["new_text"] == "Overview"
    assert history[0]["accepted"] == ["c1"]
    assert history[0]["retry_action"] == {
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
