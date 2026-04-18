async def _register(client, email: str, username: str):
    response = await client.post(
        "/users",
        json={"email": email, "username": username, "password": "pw12345"},
    )
    assert response.status_code == 201
    return response.json()["user"]


async def _create_project(client, title: str = "Docs Project"):
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


async def test_viewer_can_read_but_cannot_mutate_documents(client_factory):
    owner = await client_factory()
    viewer = await client_factory()

    await _register(owner, "owner@example.com", "owner")
    project = await _create_project(owner)
    await _register(viewer, "viewer@example.com", "viewer")
    await _add_member(owner, project["id"], "viewer", "viewer")

    main_doc_id = project["main_doc_id"]

    get_response = await viewer.get(f"/projects/{project['id']}/documents/{main_doc_id}")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == main_doc_id

    create_response = await viewer.post(
        f"/projects/{project['id']}/documents",
        json={"path": "notes.txt", "content": "viewer edit"},
    )
    assert create_response.status_code == 403

    update_response = await viewer.patch(
        f"/projects/{project['id']}/documents/{main_doc_id}",
        json={"content": "viewer override"},
    )
    assert update_response.status_code == 403

    delete_response = await viewer.delete(f"/projects/{project['id']}/documents/{main_doc_id}")
    assert delete_response.status_code == 403


async def test_editor_can_update_but_not_delete_other_users_documents(client_factory):
    owner = await client_factory()
    editor = await client_factory()

    await _register(owner, "owner2@example.com", "owner2")
    project = await _create_project(owner, "Ownership Rules")
    created_doc = await owner.post(
        f"/projects/{project['id']}/documents",
        json={"path": "chapters/intro.tex", "content": "original"},
    )
    assert created_doc.status_code == 201
    doc = created_doc.json()

    await _register(editor, "editor@example.com", "editor")
    await _add_member(owner, project["id"], "editor", "editor")

    update_response = await editor.patch(
        f"/projects/{project['id']}/documents/{doc['id']}",
        json={"content": "editor revision"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["content"] == "editor revision"
    assert update_response.json()["content_revision"] == doc["content_revision"] + 1

    delete_response = await editor.delete(f"/projects/{project['id']}/documents/{doc['id']}")
    assert delete_response.status_code == 403
    assert delete_response.json()["detail"] == "Only the document owner or project owner can delete"

    owner_delete_response = await owner.delete(f"/projects/{project['id']}/documents/{doc['id']}")
    assert owner_delete_response.status_code == 204

    missing_response = await owner.get(f"/projects/{project['id']}/documents/{doc['id']}")
    assert missing_response.status_code == 404
