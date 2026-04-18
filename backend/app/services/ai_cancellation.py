from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from contextlib import suppress
from datetime import datetime, timedelta, timezone
from typing import TypeVar

from fastapi import Request

T = TypeVar("T")

_CANCELLATION_TTL = timedelta(minutes=10)
_cancelled_actions: dict[str, datetime] = {}


class AICancelledError(RuntimeError):
    pass


def _purge_expired() -> None:
    cutoff = datetime.now(timezone.utc) - _CANCELLATION_TTL
    expired = [action_id for action_id, ts in _cancelled_actions.items() if ts < cutoff]
    for action_id in expired:
        _cancelled_actions.pop(action_id, None)


def mark_action_cancelled(action_id: str | None) -> None:
    if not action_id:
        return
    _purge_expired()
    _cancelled_actions[action_id] = datetime.now(timezone.utc)


def clear_action_cancelled(action_id: str | None) -> None:
    if not action_id:
        return
    _cancelled_actions.pop(action_id, None)


def is_action_cancelled(action_id: str | None) -> bool:
    if not action_id:
        return False
    _purge_expired()
    return action_id in _cancelled_actions


async def run_cancellable_request(
    request: Request,
    action_id: str | None,
    awaitable: Awaitable[T],
    *,
    poll_interval: float = 0.05,
) -> T:
    task = asyncio.create_task(awaitable)
    try:
        while True:
            done, _ = await asyncio.wait({task}, timeout=poll_interval)
            if task in done:
                return task.result()

            if action_id and is_action_cancelled(action_id):
                raise AICancelledError("Cancelled by user")

            if await request.is_disconnected():
                mark_action_cancelled(action_id)
                raise AICancelledError("Cancelled by user")
    except AICancelledError:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        raise
    except Exception:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        raise
