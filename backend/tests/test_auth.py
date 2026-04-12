import pytest

from app.api.auth import hash_password, verify_password


def test_password_is_hashed_not_plaintext():
    h = hash_password("hunter2")
    assert h != "hunter2"
    assert verify_password("hunter2", h)
    assert not verify_password("wrong", h)


async def test_register_login_me_flow(client):
    r = await client.post("/users", json={"email": "a@b.com", "username": "alice", "password": "pw12345"})
    assert r.status_code == 201
    assert r.json()["user"]["username"] == "alice"

    # cookie is set; /users/me should work
    me = await client.get("/users/me")
    assert me.status_code == 200
    assert me.json()["email"] == "a@b.com"


async def test_me_requires_auth(client):
    r = await client.get("/users/me")
    assert r.status_code == 401


async def test_login_wrong_password(client):
    await client.post("/users", json={"email": "a@b.com", "username": "alice", "password": "pw12345"})
    # logout
    await client.delete("/sessions/me")
    r = await client.post("/tokens", json={"email": "a@b.com", "password": "nope"})
    assert r.status_code == 401


async def test_duplicate_email_rejected(client):
    await client.post("/users", json={"email": "a@b.com", "username": "alice", "password": "pw12345"})
    r = await client.post("/users", json={"email": "a@b.com", "username": "bob", "password": "pw12345"})
    assert r.status_code == 409
