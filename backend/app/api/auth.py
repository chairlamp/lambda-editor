from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models.user import User
from app.redis_client import redis_client

router = APIRouter(tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class UserCreate(BaseModel):
    email: str
    username: str
    password: str


class UserResponse(BaseModel):
    id: str
    email: str
    username: str

    class Config:
        from_attributes = True


class SessionCreate(BaseModel):
    email: str
    password: str


class SessionResponse(BaseModel):
    user: UserResponse


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


async def create_session(user_id: str) -> str:
    session_id = str(uuid.uuid4())
    await redis_client.setex(f"session:{session_id}", settings.SESSION_TTL_SECONDS, user_id)
    return session_id


async def delete_session(session_id: str):
    await redis_client.delete(f"session:{session_id}")


async def get_session_user_id(session_id: Optional[str]) -> Optional[str]:
    if not session_id:
        return None
    user_id = await redis_client.get(f"session:{session_id}")
    if user_id:
        await redis_client.expire(f"session:{session_id}", settings.SESSION_TTL_SECONDS)
    return user_id


def _set_session_cookie(response: Response, session_id: str):
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_id,
        max_age=settings.SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=settings.SESSION_COOKIE_SECURE,
        path="/",
    )


def _clear_session_cookie(response: Response):
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")


async def get_current_user(
    session_id: Optional[str] = Cookie(default=None, alias=settings.SESSION_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> User:
    user_id = await get_session_user_id(session_id)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


@router.post("/users", response_model=SessionResponse, status_code=201)
async def create_user(
    data: UserCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    if (await db.execute(select(User).where(User.email == data.email))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    if (await db.execute(select(User).where(User.username == data.username))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Username already taken")

    user = User(
        email=data.email,
        username=data.username,
        hashed_password=hash_password(data.password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    session_id = await create_session(user.id)
    _set_session_cookie(response, session_id)
    return SessionResponse(user=UserResponse.model_validate(user))


@router.post("/tokens", response_model=SessionResponse, status_code=201)
async def create_token(
    data: SessionCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    session_id = await create_session(user.id)
    _set_session_cookie(response, session_id)
    return SessionResponse(user=UserResponse.model_validate(user))


@router.delete("/sessions/me", status_code=204)
async def delete_current_session(
    response: Response,
    session_id: Optional[str] = Cookie(default=None, alias=settings.SESSION_COOKIE_NAME),
):
    if session_id:
        await delete_session(session_id)
    _clear_session_cookie(response)
    response.status_code = 204


@router.get("/users/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user
