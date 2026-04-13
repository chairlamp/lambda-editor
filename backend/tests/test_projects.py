from app.database import AsyncSessionLocal
from app.models.ai_chat import AIChatMessage


async def _register(client, email, username):
    r = await client.post("/users", json={"email": email, "username": username, "password": "pw12345"})
    assert r.status_code == 201
    return r.json()["user"]


async def test_create_project_requires_auth(client):
    r = await client.post("/projects", json={"title": "X"})
    assert r.status_code == 401


async def test_project_owner_flow(client):
    await _register(client, "owner@x.com", "owner")
    r = await client.post("/projects", json={"title": "My Proj"})
    assert r.status_code in (200, 201)
    proj = r.json()
    assert proj["my_role"] == "owner"

    # owner can list their projects
    r = await client.get("/projects")
    assert r.status_code == 200
    assert any(p["id"] == proj["id"] for p in r.json())


async def test_non_member_cannot_see_project(client):
    await _register(client, "owner@x.com", "owner")
    r = await client.post("/projects", json={"title": "Secret"})
    proj_id = r.json()["id"]
    await client.delete("/sessions/me")

    await _register(client, "eve@x.com", "eve")
    r = await client.get(f"/projects/{proj_id}")
    assert r.status_code in (403, 404)


async def test_delete_project_cascades_ai_chat_history(client):
    user = await _register(client, "owner2@x.com", "owner2")
    r = await client.post("/projects", json={"title": "With AI"})
    assert r.status_code in (200, 201)
    project = r.json()

    async with AsyncSessionLocal() as db:
        db.add(AIChatMessage(
            document_id=project["main_doc_id"],
            user_id=user["id"],
            role="assistant",
            content="hello",
        ))
        await db.commit()

    r = await client.delete(f"/projects/{project['id']}")
    assert r.status_code == 204

    r = await client.get("/projects")
    assert r.status_code == 200
    assert all(p["id"] != project["id"] for p in r.json())
