import asyncio

import pytest

from app.services.ai_cancellation import (
    AICancelledError,
    clear_action_cancelled,
    mark_action_cancelled,
    run_cancellable_request,
)


class FakeRequest:
    def __init__(self, *, disconnect_after_checks: int | None = None):
        self.disconnect_after_checks = disconnect_after_checks
        self.checks = 0

    async def is_disconnected(self) -> bool:
        self.checks += 1
        return self.disconnect_after_checks is not None and self.checks >= self.disconnect_after_checks


async def test_run_cancellable_request_cancels_when_client_disconnects():
    cancelled = asyncio.Event()

    async def slow_operation():
        try:
            await asyncio.sleep(5)
            return {"ok": True}
        except asyncio.CancelledError:
            cancelled.set()
            raise

    with pytest.raises(AICancelledError, match="Cancelled by user"):
        await run_cancellable_request(FakeRequest(disconnect_after_checks=1), "disconnect-act", slow_operation())

    assert cancelled.is_set()


async def test_run_cancellable_request_cancels_when_action_is_marked_cancelled():
    cancelled = asyncio.Event()

    async def slow_operation():
        try:
            await asyncio.sleep(5)
            return {"ok": True}
        except asyncio.CancelledError:
            cancelled.set()
            raise

    mark_action_cancelled("marked-act")
    try:
        with pytest.raises(AICancelledError, match="Cancelled by user"):
            await run_cancellable_request(FakeRequest(), "marked-act", slow_operation())
    finally:
        clear_action_cancelled("marked-act")

    assert cancelled.is_set()
