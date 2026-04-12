from __future__ import annotations

from datetime import datetime, timedelta, timezone
import uuid
from typing import Optional

import jwt
from jwt import ExpiredSignatureError, InvalidTokenError
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
ACCESS_TOKEN_TYPE = "access"
REFRESH_TOKEN_TYPE = "refresh"


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


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _refresh_token_key(jti: str) -> str:
    return f"refresh:{jti}"


def _encode_token(*, user_id: str, token_type: str, ttl_seconds: int, jti: Optional[str] = None) -> str:
    issued_at = _utcnow()
    payload = {
        "sub": user_id,
        "type": token_type,
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + timedelta(seconds=ttl_seconds)).timestamp()),
    }
    if jti:
        payload["jti"] = jti
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def _decode_token(token: str, *, expected_type: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.JWT_ALGORITHM],
            options={"require": ["sub", "type", "iat", "exp"]},
        )
    except ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired") from exc
    except InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    if payload.get("type") != expected_type:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return payload


async def _issue_token_pair(user_id: str) -> tuple[str, str]:
    refresh_jti = str(uuid.uuid4())
    access_token = _encode_token(
        user_id=user_id,
        token_type=ACCESS_TOKEN_TYPE,
        ttl_seconds=settings.ACCESS_TOKEN_TTL_SECONDS,
    )
    refresh_token = _encode_token(
        user_id=user_id,
        token_type=REFRESH_TOKEN_TYPE,
        ttl_seconds=settings.REFRESH_TOKEN_TTL_SECONDS,
        jti=refresh_jti,
    )
    await redis_client.setex(
        _refresh_token_key(refresh_jti),
        settings.REFRESH_TOKEN_TTL_SECONDS,
        user_id,
    )
    return access_token, refresh_token


async def _revoke_refresh_token(refresh_token: Optional[str]) -> None:
    if not refresh_token:
        return
    try:
        payload = _decode_token(refresh_token, expected_type=REFRESH_TOKEN_TYPE)
    except HTTPException:
        return
    refresh_jti = payload.get("jti")
    if isinstance(refresh_jti, str):
        await redis_client.delete(_refresh_token_key(refresh_jti))


async def _authenticate_refresh_token(refresh_token: Optional[str]) -> dict:
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = _decode_token(refresh_token, expected_type=REFRESH_TOKEN_TYPE)
    refresh_jti = payload.get("jti")
    user_id = payload.get("sub")
    if not isinstance(refresh_jti, str) or not isinstance(user_id, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    stored_user_id = await redis_client.get(_refresh_token_key(refresh_jti))
    if stored_user_id != user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return payload


def _set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    response.set_cookie(
        key=settings.ACCESS_TOKEN_COOKIE_NAME,
        value=access_token,
        max_age=settings.ACCESS_TOKEN_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=settings.AUTH_COOKIE_SECURE,
        path="/",
    )
    response.set_cookie(
        key=settings.REFRESH_TOKEN_COOKIE_NAME,
        value=refresh_token,
        max_age=settings.REFRESH_TOKEN_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=settings.AUTH_COOKIE_SECURE,
        path="/",
    )


def _clear_auth_cookies(response: Response):
    response.delete_cookie(settings.ACCESS_TOKEN_COOKIE_NAME, path="/")
    response.delete_cookie(settings.REFRESH_TOKEN_COOKIE_NAME, path="/")


async def get_current_user(
    access_token: Optional[str] = Cookie(default=None, alias=settings.ACCESS_TOKEN_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not access_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = _decode_token(access_token, expected_type=ACCESS_TOKEN_TYPE)
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user


async def get_authenticated_user_id_from_cookies(
    access_token: Optional[str],
    refresh_token: Optional[str],
) -> Optional[str]:
    if access_token:
        try:
            payload = _decode_token(access_token, expected_type=ACCESS_TOKEN_TYPE)
            user_id = payload.get("sub")
            if isinstance(user_id, str):
                return user_id
        except HTTPException:
            pass

    if refresh_token:
        try:
            payload = await _authenticate_refresh_token(refresh_token)
            user_id = payload.get("sub")
            if isinstance(user_id, str):
                return user_id
        except HTTPException:
            return None

    return None


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

    access_token, refresh_token = await _issue_token_pair(user.id)
    _set_auth_cookies(response, access_token, refresh_token)
    return SessionResponse(user=UserResponse.model_validate(user))


@router.post("/tokens", response_model=SessionResponse, status_code=200)
async def create_token(
    data: SessionCreate,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == data.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token, refresh_token = await _issue_token_pair(user.id)
    _set_auth_cookies(response, access_token, refresh_token)
    return SessionResponse(user=UserResponse.model_validate(user))


@router.delete("/sessions/me", status_code=204)
async def delete_current_session(
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None, alias=settings.REFRESH_TOKEN_COOKIE_NAME),
):
    await _revoke_refresh_token(refresh_token)
    _clear_auth_cookies(response)
    response.status_code = 204


@router.post("/tokens/refresh", response_model=SessionResponse, status_code=200)
async def refresh_token(
    response: Response,
    refresh_token: Optional[str] = Cookie(default=None, alias=settings.REFRESH_TOKEN_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
):
    payload = await _authenticate_refresh_token(refresh_token)
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    await _revoke_refresh_token(refresh_token)
    access_token, next_refresh_token = await _issue_token_pair(user.id)
    _set_auth_cookies(response, access_token, next_refresh_token)
    return SessionResponse(user=UserResponse.model_validate(user))


@router.get("/users/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user
