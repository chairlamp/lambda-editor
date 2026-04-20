from __future__ import annotations
import asyncio
import json
import logging
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.models.document import Document
from app.models.ai_chat import AIChatMessage
from app.api.auth import get_current_user
from app.api.projects import _require_project
from app.database import get_db
from app.services.ai_audit import (
    AI_STATUS_CANCELLED,
    AI_STATUS_COMPLETED,
    AI_STATUS_FAILED,
    AI_STATUS_SUBMITTED,
    infer_provider_model,
)
from app.services.ai_cancellation import (
    AICancelledError,
    clear_action_cancelled,
    run_cancellable_request,
)
from app.services import ai_service
from app.services import agent_service
from app.websocket.manager import manager

logger = logging.getLogger(__name__)

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    # Disable proxy buffering (Nginx/Cloudflare) so chunks reach the client immediately.
    "X-Accel-Buffering": "no",
}

# Idle proxies (Nginx default 60s, Cloudflare ~100s) close SSE connections when no
# bytes flow. Emit an SSE comment line every KEEPALIVE_INTERVAL_SECONDS so slow LLM
# generations survive those timeouts. Comments are ignored by compliant clients.
KEEPALIVE_INTERVAL_SECONDS = 15.0
_HEARTBEAT = object()


async def _with_heartbeats(aiter, interval: float):
    """Yield items from ``aiter``, injecting ``_HEARTBEAT`` during idle gaps."""
    it = aiter.__aiter__()
    pending: Optional[asyncio.Task] = asyncio.ensure_future(it.__anext__())
    try:
        while True:
            done, _ = await asyncio.wait({pending}, timeout=interval)
            if not done:
                yield _HEARTBEAT
                continue
            try:
                yield pending.result()
            except StopAsyncIteration:
                return
            pending = asyncio.ensure_future(it.__anext__())
    finally:
        if pending is not None and not pending.done():
            pending.cancel()


router = APIRouter(tags=["ai"])


class GenerateRequest(BaseModel):
    prompt: str
    document_context: Optional[str] = ""
    action_id: Optional[str] = None
    thread_id: Optional[str] = None


class AgentRequest(BaseModel):
    prompt: str
    document_context: Optional[str] = ""
    action_id: Optional[str] = None
    thread_id: Optional[str] = None


class RewriteRequest(BaseModel):
    text: str
    style: str  # academic | simplify | expand | continue | summarize | translate:{lang} | restructure
    document_context: Optional[str] = ""
    action_id: Optional[str] = None
    thread_id: Optional[str] = None


class FixLatexRequest(BaseModel):
    code: str
    error_log: str


class EquationRequest(BaseModel):
    description: str


class ConvertRequest(BaseModel):
    plain_text: str


class ExplainErrorRequest(BaseModel):
    error_log: str


class SuggestChangesRequest(BaseModel):
    instruction: str
    document_content: str
    variation_request: Optional[str] = ""
    action_id: Optional[str] = None
    thread_id: Optional[str] = None


class TranslateDiffRequest(BaseModel):
    language: str
    text: str = ""
    document_content: str
    variation_request: Optional[str] = ""
    action_id: Optional[str] = None
    thread_id: Optional[str] = None


class RewriteDiffRequest(BaseModel):
    text: str = ""
    style: str
    document_content: str
    variation_request: Optional[str] = ""
    action_id: Optional[str] = None
    thread_id: Optional[str] = None


class LocationContext(BaseModel):
    line: int
    text: str = ""
    beforeText: str = ""
    afterText: str = ""


class EquationDiffRequest(BaseModel):
    description: str
    document_content: str
    location: Optional[LocationContext] = None
    variation_request: Optional[str] = ""
    action_id: Optional[str] = None
    thread_id: Optional[str] = None


class ChatHistoryMessageResponse(BaseModel):
    id: str
    thread_id: str
    role: str
    content: str
    action_type: Optional[str] = None
    action_prompt: Optional[str] = None
    quotes: Optional[list[dict]] = None
    sources: Optional[list[dict]] = None
    tool_calls: Optional[list[str]] = None
    diff: Optional[dict] = None
    retry_action: Optional[dict] = None
    accepted: Optional[list[str]] = None
    rejected: Optional[list[str]] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    status: Optional[str] = None
    error: Optional[str] = None
    from_user: Optional[str] = None
    created_at: Optional[str] = None


class ChatThreadSummaryResponse(BaseModel):
    id: str
    title: str
    preview: str
    message_count: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ReviewStateUpdateRequest(BaseModel):
    accepted: list[str] = []
    rejected: list[str] = []


AI_HISTORY_RETENTION_DAYS = 30


async def _require_document_access(project_id: str, doc_id: str, user_id: str, db: AsyncSession):
    await _require_project(project_id, user_id, db)
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    doc = result.scalar_one_or_none()
    if doc and doc.kind != "latex":
        raise HTTPException(status_code=400, detail="AI chat is only available for LaTeX documents")
    return doc


async def _purge_ai_history(db: AsyncSession, *, doc_id: Optional[str] = None):
    cutoff = datetime.now(timezone.utc) - timedelta(days=AI_HISTORY_RETENTION_DAYS)
    result = await db.execute(select(AIChatMessage))
    expired = [
        message
        for message in result.scalars().all()
        if message.created_at and message.created_at.replace(tzinfo=timezone.utc) < cutoff
        and (doc_id is None or message.document_id == doc_id)
    ]
    if not expired:
        return
    for message in expired:
        await db.delete(message)
    await db.commit()


async def _require_document_edit_access(project_id: str, doc_id: str, user_id: str, db: AsyncSession):
    await _require_project(project_id, user_id, db, min_role="editor")
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.kind != "latex":
        raise HTTPException(status_code=400, detail="AI chat is only available for LaTeX documents")
    return doc


def _loads(payload: Optional[str], fallback):
    if not payload:
        return fallback
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return fallback


def _resolve_thread_id(doc_id: str, thread_id: Optional[str]) -> str:
    return (thread_id or "").strip() or doc_id


def _truncate_text(value: Optional[str], limit: int = 72) -> str:
    text = " ".join((value or "").strip().split())
    if not text:
        return ""
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1].rstrip()}…"


def _action_label(action_type: Optional[str]) -> str:
    labels = {
        "suggest": "AI edit",
        "translate": "Translate",
        "equation": "Equation",
        "summarize": "Summarize",
        "simplify": "Simplify",
    }
    return labels.get(action_type or "", (action_type or "New chat").replace("_", " ").strip().title() or "New chat")


def _thread_title(message: AIChatMessage) -> str:
    return (
        _truncate_text(message.action_prompt, 48)
        or _truncate_text(message.content, 48)
        or _action_label(message.action_type)
    )


def _message_preview(message: AIChatMessage) -> str:
    if message.error_message:
        return _truncate_text(message.error_message, 96)
    diff = _loads(message.diff_json, {})
    if isinstance(diff, dict):
        explanation = diff.get("explanation")
        if isinstance(explanation, str) and explanation.strip():
            return _truncate_text(explanation, 96)
    return (
        _truncate_text(message.content, 96)
        or _truncate_text(message.action_prompt, 96)
        or _action_label(message.action_type)
    )


def _build_thread_summaries(rows: list[tuple[AIChatMessage, str]], doc_id: str) -> list[ChatThreadSummaryResponse]:
    grouped: OrderedDict[str, list[tuple[AIChatMessage, str]]] = OrderedDict()
    for message, username in rows:
        resolved_thread_id = _resolve_thread_id(doc_id, message.thread_id)
        grouped.setdefault(resolved_thread_id, []).append((message, username))

    summaries: list[tuple[datetime, ChatThreadSummaryResponse]] = []
    for thread_id, items in grouped.items():
        first_user_message = next((message for message, _ in items if message.role == "user"), items[0][0])
        latest_message = items[-1][0]
        latest_timestamp = latest_message.created_at or datetime.min
        summaries.append((
            latest_timestamp,
            ChatThreadSummaryResponse(
                id=thread_id,
                title=_thread_title(first_user_message),
                preview=_message_preview(latest_message),
                message_count=len(items),
                created_at=items[0][0].created_at.isoformat() if items[0][0].created_at else None,
                updated_at=latest_message.created_at.isoformat() if latest_message.created_at else None,
            ),
        ))

    summaries.sort(key=lambda entry: (entry[0], entry[1].id), reverse=True)
    return [summary for _, summary in summaries]


async def _persist_assistant_message(
    db: AsyncSession,
    user_id: str,
    project_id: Optional[str],
    doc_id: Optional[str],
    message_id: Optional[str],
    thread_id: Optional[str] = None,
    *,
    content: str = "",
    sources: Optional[list[dict]] = None,
    tool_calls: Optional[list[str]] = None,
    diff: Optional[dict] = None,
    retry_action: Optional[dict] = None,
    action_type: Optional[str] = None,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    status: str = AI_STATUS_COMPLETED,
    error_message: Optional[str] = None,
):
    if not project_id or not doc_id or not message_id:
        return

    resolved_thread_id = _resolve_thread_id(doc_id, thread_id)
    await _purge_ai_history(db, doc_id=doc_id)
    doc = await _require_document_access(project_id, doc_id, user_id, db)
    if not doc:
        return

    existing = await db.get(AIChatMessage, message_id)
    if existing:
        if not existing.thread_id:
            existing.thread_id = resolved_thread_id
        if provider and not existing.provider:
            existing.provider = provider
        if model and not existing.model:
            existing.model = model
        if status and not existing.status:
            existing.status = status
        if error_message and not existing.error_message:
            existing.error_message = error_message
        await db.commit()
        return

    resolved_provider, resolved_model = (
        (provider, model)
        if provider and model
        else infer_provider_model(action_type=action_type, tool_calls=tool_calls)
    )

    db.add(AIChatMessage(
        id=message_id,
        document_id=doc_id,
        thread_id=resolved_thread_id,
        user_id=user_id,
        role="assistant",
        content=content,
        action_type=action_type,
        quotes_json=json.dumps(sources) if sources is not None else None,
        diff_json=json.dumps(diff) if diff is not None else None,
        retry_action_json=json.dumps(
            retry_action if retry_action is not None else (
                {"tool_calls": tool_calls} if tool_calls is not None else None
            )
        ) if (retry_action is not None or tool_calls is not None) else None,
        provider=resolved_provider,
        model=resolved_model,
        status=status,
        error_message=error_message,
    ))
    await db.commit()


async def _persist_user_message(
    db: AsyncSession,
    user_id: str,
    project_id: Optional[str],
    doc_id: Optional[str],
    message_id: Optional[str],
    thread_id: Optional[str] = None,
    *,
    content: str = "",
    action_type: Optional[str] = None,
    action_prompt: Optional[str] = None,
    quotes: Optional[list[dict]] = None,
):
    if not project_id or not doc_id or not message_id:
        return

    resolved_thread_id = _resolve_thread_id(doc_id, thread_id)
    await _purge_ai_history(db, doc_id=doc_id)
    doc = await _require_document_access(project_id, doc_id, user_id, db)
    if not doc:
        return

    provider, model = infer_provider_model(action_type=action_type)
    existing = await db.get(AIChatMessage, message_id)
    if existing:
        if not existing.thread_id:
            existing.thread_id = resolved_thread_id
        if content and not existing.content:
            existing.content = content
        if action_type and not existing.action_type:
            existing.action_type = action_type
        if action_prompt and not existing.action_prompt:
            existing.action_prompt = action_prompt
        if quotes is not None and not existing.quotes_json:
            existing.quotes_json = json.dumps(quotes)
        if provider and not existing.provider:
            existing.provider = provider
        if model and not existing.model:
            existing.model = model
        if not existing.status:
            existing.status = AI_STATUS_SUBMITTED
        await db.commit()
        return

    db.add(AIChatMessage(
        id=message_id,
        document_id=doc_id,
        thread_id=resolved_thread_id,
        user_id=user_id,
        role="user",
        content=content,
        action_type=action_type,
        action_prompt=action_prompt,
        quotes_json=json.dumps(quotes) if quotes is not None else None,
        provider=provider,
        model=model,
        status=AI_STATUS_SUBMITTED,
    ))
    await db.commit()


async def _persist_cancelled_action(
    db: AsyncSession,
    user_id: str,
    project_id: Optional[str],
    doc_id: Optional[str],
    action_id: Optional[str],
    response_id: Optional[str],
    thread_id: Optional[str] = None,
    *,
    action_type: Optional[str] = None,
    retry_action: Optional[dict] = None,
    is_diff: bool = False,
    partial_content: str = "",
):
    if not project_id or not doc_id:
        return

    resolved_thread_id = _resolve_thread_id(doc_id, thread_id)
    await _purge_ai_history(db, doc_id=doc_id)
    doc = await _require_document_access(project_id, doc_id, user_id, db)
    if not doc:
        return

    cancellation_message = "Cancelled by user"
    user_message = await db.get(AIChatMessage, action_id) if action_id else None
    resolved_action_type = action_type or (user_message.action_type if user_message else None)
    provider, model = infer_provider_model(action_type=resolved_action_type)

    if user_message:
        if not user_message.thread_id:
            user_message.thread_id = resolved_thread_id
        user_message.status = AI_STATUS_CANCELLED
        user_message.error_message = cancellation_message

    assistant_message = await db.get(AIChatMessage, response_id) if response_id else None
    if assistant_message:
        if not assistant_message.thread_id:
            assistant_message.thread_id = resolved_thread_id
        assistant_message.status = AI_STATUS_CANCELLED
        assistant_message.error_message = cancellation_message
        if resolved_action_type and not assistant_message.action_type:
            assistant_message.action_type = resolved_action_type
        if provider and not assistant_message.provider:
            assistant_message.provider = provider
        if model and not assistant_message.model:
            assistant_message.model = model
        if partial_content and not assistant_message.content:
            assistant_message.content = partial_content
        if is_diff and not assistant_message.diff_json:
            assistant_message.diff_json = json.dumps({"explanation": cancellation_message, "changes": []})
        if retry_action is not None and not assistant_message.retry_action_json:
            assistant_message.retry_action_json = json.dumps(retry_action)
    elif response_id:
        db.add(AIChatMessage(
            id=response_id,
            document_id=doc_id,
            thread_id=resolved_thread_id,
            user_id=user_id,
            role="assistant",
            content=partial_content or ("" if is_diff else cancellation_message),
            action_type=resolved_action_type,
            diff_json=json.dumps({"explanation": cancellation_message, "changes": []}) if is_diff else None,
            retry_action_json=json.dumps(retry_action) if retry_action is not None else None,
            provider=provider,
            model=model,
            status=AI_STATUS_CANCELLED,
            error_message=cancellation_message,
        ))

    await db.commit()


def _sse(
    request: Request | None,
    generator,
    *,
    on_complete=None,
    on_error=None,
    on_cancel=None,
    doc_id: Optional[str] = None,
    action_id: Optional[str] = None,
    thread_id: Optional[str] = None,
    broadcast_exclude_user_id: Optional[str] = None,
    actor_username: Optional[str] = None,
):
    """Wrap an async text generator as an SSE stream.

    Chunks are JSON-encoded so embedded newlines survive SSE framing, and
    mirrored to the document's WebSocket room so collaborators see live
    tokens. Errors surface as an explicit ``event: error`` frame; client
    disconnects cancel the generator cleanly without running ``on_complete``.
    """

    def room_message(event: str, **extra: object) -> dict[str, object]:
        message: dict[str, object] = {
            "type": "ai_chat",
            "event": event,
            "action_id": action_id,
        }
        if actor_username:
            message["username"] = actor_username
        if thread_id:
            message["thread_id"] = thread_id
        message.update(extra)
        return message

    async def generate():
        collected: list[str] = []
        # A leading comment flushes headers/intermediaries before the first token.
        yield ": open\n\n"
        try:
            async for chunk in _with_heartbeats(generator, KEEPALIVE_INTERVAL_SECONDS):
                if chunk is _HEARTBEAT:
                    yield ": ping\n\n"
                    continue
                collected.append(chunk)
                if doc_id:
                    await manager.broadcast_to_room(
                        doc_id,
                        room_message("chunk", content=chunk),
                        exclude=broadcast_exclude_user_id,
                    )
                yield f"data: {json.dumps(chunk)}\n\n"
        except asyncio.CancelledError:
            # Client disconnect cancels the generator; on_cancel lets callers persist
            # partial state (e.g. mark the action cancelled) before we propagate.
            if on_cancel is not None:
                await on_cancel("".join(collected))
            if doc_id:
                await manager.broadcast_to_room(
                    doc_id,
                    room_message(
                        "cancelled",
                        response_kind="res",
                        status=AI_STATUS_CANCELLED,
                        error="Cancelled by user",
                    ),
                    exclude=broadcast_exclude_user_id,
                )
            raise
        except Exception as exc:  # noqa: BLE001 — surface any provider error to the client
            logger.exception("AI stream failed")
            if on_error is not None:
                await on_error(str(exc))
            if doc_id:
                await manager.broadcast_to_room(
                    doc_id,
                    room_message(
                        "done",
                        status=AI_STATUS_FAILED,
                        error=str(exc) or "stream_failed",
                    ),
                    exclude=broadcast_exclude_user_id,
                )
            yield f"event: error\ndata: {json.dumps(str(exc) or 'stream_failed')}\n\n"
            yield "data: [DONE]\n\n"
            return
        if on_complete is not None:
            try:
                await on_complete("".join(collected))
            except Exception:  # noqa: BLE001 — persistence failure should not kill the stream
                logger.exception("AI stream on_complete failed")

        if doc_id:
            await manager.broadcast_to_room(
                doc_id,
                room_message("done", status=AI_STATUS_COMPLETED),
                exclude=broadcast_exclude_user_id,
            )

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@router.post("/projects/{project_id}/documents/{doc_id}/ai/text-generations")
async def generate(
    request: Request,
    project_id: str,
    doc_id: str,
    req: GenerateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        content=req.prompt,
        action_prompt=req.prompt,
    )
    return _sse(
        request,
        ai_service.generate_text(req.prompt, req.document_context or ""),
        on_complete=lambda content: _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            content=content,
            status=AI_STATUS_COMPLETED,
        ),
        on_error=lambda error: _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            content="",
            status=AI_STATUS_FAILED,
            error_message=error,
        ),
        on_cancel=lambda content: _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            partial_content=content,
        ),
        doc_id=doc_id,
        action_id=req.action_id,
        thread_id=resolved_thread_id,
        broadcast_exclude_user_id=current_user.id,
        actor_username=current_user.username,
    )


@router.post("/projects/{project_id}/documents/{doc_id}/ai/messages")
async def agent_chat(
    request: Request,
    project_id: str,
    doc_id: str,
    req: AgentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        content=req.prompt,
        action_prompt=req.prompt,
    )
    try:
        result = await run_cancellable_request(
            request,
            req.action_id,
            agent_service.run_tool_enabled_chat(req.prompt, req.document_context or ""),
        )
    except AICancelledError:
        await _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
        )
        raise HTTPException(status_code=499, detail="Request cancelled")
    except RuntimeError as exc:
        await _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            content="",
            status=AI_STATUS_FAILED,
            error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        clear_action_cancelled(req.action_id)

    provider, model = infer_provider_model(tool_calls=result.get("tools_used") or None)
    await _persist_assistant_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        f"{req.action_id}-res" if req.action_id else None,
        thread_id=resolved_thread_id,
        content=result.get("content", ""),
        sources=result.get("sources") or None,
        tool_calls=result.get("tools_used") or None,
        status=AI_STATUS_COMPLETED,
    )
    return {
        **result,
        "provider": provider,
        "model": model,
        "status": AI_STATUS_COMPLETED,
    }


@router.post("/projects/{project_id}/documents/{doc_id}/ai/message-streams")
async def agent_chat_stream(
    request: Request,
    project_id: str,
    doc_id: str,
    req: AgentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        content=req.prompt,
        action_prompt=req.prompt,
    )

    result_holder: dict[str, object] = {}

    async def stream_result():
        try:
            async for chunk in agent_service.stream_tool_enabled_chat(
                req.prompt,
                req.document_context or "",
                result_holder,
            ):
                yield chunk
        finally:
            clear_action_cancelled(req.action_id)

    async def on_complete(content: str):
        provider, model = infer_provider_model(tool_calls=result_holder.get("tools_used") or None)
        sources = result_holder.get("sources") or None
        tool_calls = result_holder.get("tools_used") or None
        resolved_content = str(result_holder.get("content") or content or "")
        await _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            content=resolved_content,
            sources=sources,
            tool_calls=tool_calls,
            provider=provider,
            model=model,
            status=AI_STATUS_COMPLETED,
        )
        await manager.broadcast_to_room(
            doc_id,
            {
                "type": "ai_chat",
                "event": "agent_result",
                "action_id": req.action_id,
                "thread_id": resolved_thread_id,
                "username": current_user.username,
                "content": resolved_content,
                "sources": sources,
                "tool_calls": tool_calls,
                "provider": provider,
                "model": model,
                "status": AI_STATUS_COMPLETED,
            },
            exclude=current_user.id,
        )

    async def on_error(error: str):
        await _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            content="",
            status=AI_STATUS_FAILED,
            error_message=error,
        )
        await manager.broadcast_to_room(
            doc_id,
            {
                "type": "ai_chat",
                "event": "agent_result",
                "action_id": req.action_id,
                "thread_id": resolved_thread_id,
                "username": current_user.username,
                "content": f"**Error:** {error}",
                "status": AI_STATUS_FAILED,
                "error": error,
            },
            exclude=current_user.id,
        )

    return _sse(
        request,
        stream_result(),
        on_complete=on_complete,
        on_error=on_error,
        on_cancel=lambda content: _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            partial_content=content,
        ),
        doc_id=doc_id,
        action_id=req.action_id,
        thread_id=resolved_thread_id,
        broadcast_exclude_user_id=current_user.id,
        actor_username=current_user.username,
    )


@router.post("/projects/{project_id}/documents/{doc_id}/ai/rewrites")
async def rewrite(
    request: Request,
    project_id: str,
    doc_id: str,
    req: RewriteRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        action_type=req.style,
        action_prompt=req.text or "Full document",
    )
    return _sse(
        request,
        ai_service.rewrite_text(req.text, req.style, req.document_context or ""),
        on_complete=lambda content: _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            content=content,
            action_type=req.style,
            status=AI_STATUS_COMPLETED,
        ),
        on_error=lambda error: _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            content="",
            action_type=req.style,
            status=AI_STATUS_FAILED,
            error_message=error,
        ),
        on_cancel=lambda content: _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-res" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type=req.style,
            partial_content=content,
        ),
        doc_id=doc_id,
        action_id=req.action_id,
        thread_id=resolved_thread_id,
        broadcast_exclude_user_id=current_user.id,
        actor_username=current_user.username,
    )


@router.post("/ai/latex-fixes")
async def fix_latex(req: FixLatexRequest, current_user: User = Depends(get_current_user)):
    return _sse(None, ai_service.fix_latex(req.code, req.error_log))


@router.post("/ai/equations")
async def equation(req: EquationRequest, current_user: User = Depends(get_current_user)):
    return _sse(None, ai_service.generate_equation(req.description))


@router.post("/ai/latex-conversions")
async def convert(req: ConvertRequest, current_user: User = Depends(get_current_user)):
    return _sse(None, ai_service.convert_to_latex(req.plain_text))


@router.post("/ai/error-explanations")
async def explain_error(req: ExplainErrorRequest, current_user: User = Depends(get_current_user)):
    return _sse(None, ai_service.explain_error(req.error_log))


@router.post("/projects/{project_id}/documents/{doc_id}/ai/change-suggestions")
async def suggest_changes(
    request: Request,
    project_id: str,
    doc_id: str,
    req: SuggestChangesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a structured JSON diff: explanation + list of hunks with old_text/new_text."""
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        action_type="suggest",
        action_prompt=req.instruction,
    )
    try:
        result = await run_cancellable_request(
            request,
            req.action_id,
            ai_service.suggest_changes(req.instruction, req.document_content, req.variation_request or ""),
        )
    except AICancelledError:
        await _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type="suggest",
            retry_action={"type": "suggest", "instruction": req.instruction},
            is_diff=True,
        )
        raise HTTPException(status_code=499, detail="Request cancelled")
    except Exception as exc:
        await _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type="suggest",
            diff={"explanation": str(exc), "changes": []},
            retry_action={"type": "suggest", "instruction": req.instruction},
            status=AI_STATUS_FAILED,
            error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        clear_action_cancelled(req.action_id)
    await _persist_assistant_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        thread_id=resolved_thread_id,
        diff=result,
        action_type="suggest",
        retry_action={"type": "suggest", "instruction": req.instruction},
        tool_calls=result.get("tool_calls"),
        status=AI_STATUS_COMPLETED,
    )
    provider, model = infer_provider_model(action_type="suggest", tool_calls=result.get("tool_calls"))
    return {**result, "provider": provider, "model": model, "status": AI_STATUS_COMPLETED}


@router.post("/projects/{project_id}/documents/{doc_id}/ai/rewrite-suggestions")
async def rewrite_diff(
    request: Request,
    project_id: str,
    doc_id: str,
    req: RewriteDiffRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        action_type=req.style,
        action_prompt=req.text or "Full document",
    )
    try:
        result = await run_cancellable_request(
            request,
            req.action_id,
            ai_service.rewrite_diff(req.text, req.style, req.document_content, req.variation_request or ""),
        )
    except AICancelledError:
        await _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type=req.style,
            retry_action={"type": req.style, "text": req.text},
            is_diff=True,
        )
        raise HTTPException(status_code=499, detail="Request cancelled")
    except Exception as exc:
        await _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type=req.style,
            diff={"explanation": str(exc), "changes": []},
            retry_action={"type": req.style, "text": req.text},
            status=AI_STATUS_FAILED,
            error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        clear_action_cancelled(req.action_id)
    await _persist_assistant_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        thread_id=resolved_thread_id,
        diff=result,
        action_type=req.style,
        retry_action={"type": req.style, "text": req.text},
        tool_calls=result.get("tool_calls"),
        status=AI_STATUS_COMPLETED,
    )
    provider, model = infer_provider_model(action_type=req.style, tool_calls=result.get("tool_calls"))
    return {**result, "provider": provider, "model": model, "status": AI_STATUS_COMPLETED}


@router.post("/projects/{project_id}/documents/{doc_id}/ai/translation-suggestions")
async def translate_diff(
    request: Request,
    project_id: str,
    doc_id: str,
    req: TranslateDiffRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        action_type="translate",
        action_prompt=req.language,
    )
    try:
        result = await run_cancellable_request(
            request,
            req.action_id,
            agent_service.translate_diff_with_tool(
                req.language,
                req.text,
                req.document_content,
                req.variation_request or "",
            ),
        )
    except AICancelledError:
        await _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type="translate",
            retry_action={
                "type": "translate",
                "language": req.language,
                "text": req.text,
            },
            is_diff=True,
        )
        raise HTTPException(status_code=499, detail="Request cancelled")
    except Exception as exc:
        await _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type="translate",
            diff={"explanation": str(exc), "changes": []},
            retry_action={
                "type": "translate",
                "language": req.language,
                "text": req.text,
            },
            tool_calls=["translate_text"],
            status=AI_STATUS_FAILED,
            error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        clear_action_cancelled(req.action_id)
    error_message = str(result.get("error") or "").strip()
    status = AI_STATUS_FAILED if error_message else AI_STATUS_COMPLETED
    await _persist_assistant_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        thread_id=resolved_thread_id,
        diff=result,
        action_type="translate",
        retry_action={
            "type": "translate",
            "language": req.language,
            "text": req.text,
            "tool_calls": result.get("tool_calls", []),
        },
        tool_calls=result.get("tool_calls"),
        status=status,
        error_message=error_message or None,
    )
    if error_message:
        raise HTTPException(status_code=503, detail=error_message)
    provider, model = infer_provider_model(action_type="translate", tool_calls=result.get("tool_calls"))
    return {**result, "provider": provider, "model": model, "status": status}


@router.post("/projects/{project_id}/documents/{doc_id}/ai/equation-suggestions")
async def equation_diff(
    request: Request,
    project_id: str,
    doc_id: str,
    req: EquationDiffRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, req.thread_id)
    await _persist_user_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        req.action_id,
        thread_id=resolved_thread_id,
        action_type="equation",
        action_prompt=req.description,
    )
    try:
        result = await run_cancellable_request(
            request,
            req.action_id,
            ai_service.equation_diff(
                req.description,
                req.document_content,
                req.location.model_dump() if req.location else None,
                req.variation_request or "",
            ),
        )
    except AICancelledError:
        await _persist_cancelled_action(
            db,
            current_user.id,
            project_id,
            doc_id,
            req.action_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type="equation",
            retry_action={
                "type": "equation",
                "description": req.description,
                "location": req.location.model_dump() if req.location else None,
            },
            is_diff=True,
        )
        raise HTTPException(status_code=499, detail="Request cancelled")
    except Exception as exc:
        await _persist_assistant_message(
            db,
            current_user.id,
            project_id,
            doc_id,
            f"{req.action_id}-diff" if req.action_id else None,
            thread_id=resolved_thread_id,
            action_type="equation",
            diff={"explanation": str(exc), "changes": []},
            retry_action={
                "type": "equation",
                "description": req.description,
                "location": req.location.model_dump() if req.location else None,
            },
            status=AI_STATUS_FAILED,
            error_message=str(exc),
        )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        clear_action_cancelled(req.action_id)
    await _persist_assistant_message(
        db,
        current_user.id,
        project_id,
        doc_id,
        f"{req.action_id}-diff" if req.action_id else None,
        thread_id=resolved_thread_id,
        diff=result,
        action_type="equation",
        retry_action={
            "type": "equation",
            "description": req.description,
            "location": req.location.model_dump() if req.location else None,
        },
        tool_calls=result.get("tool_calls"),
        status=AI_STATUS_COMPLETED,
    )
    provider, model = infer_provider_model(action_type="equation", tool_calls=result.get("tool_calls"))
    return {**result, "provider": provider, "model": model, "status": AI_STATUS_COMPLETED}


@router.get("/projects/{project_id}/documents/{doc_id}/ai/threads", response_model=list[ChatThreadSummaryResponse])
async def get_threads(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _purge_ai_history(db, doc_id=doc_id)
    doc = await _require_document_access(project_id, doc_id, current_user.id, db)
    if not doc:
        return []

    result = await db.execute(
        select(AIChatMessage, User.username)
        .join(User, AIChatMessage.user_id == User.id)
        .where(AIChatMessage.document_id == doc_id)
        .order_by(AIChatMessage.created_at.asc(), AIChatMessage.id.asc())
    )
    return _build_thread_summaries(result.all(), doc_id)


@router.delete("/projects/{project_id}/documents/{doc_id}/ai/threads/{thread_id}")
async def delete_thread(
    project_id: str,
    doc_id: str,
    thread_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _purge_ai_history(db, doc_id=doc_id)
    await _require_document_edit_access(project_id, doc_id, current_user.id, db)
    resolved_thread_id = _resolve_thread_id(doc_id, thread_id)
    result = await db.execute(
        select(AIChatMessage).where(
            AIChatMessage.document_id == doc_id,
            AIChatMessage.thread_id == resolved_thread_id,
        )
    )
    messages = result.scalars().all()
    if not messages:
        raise HTTPException(status_code=404, detail="Thread not found")

    for message in messages:
        await db.delete(message)
    await db.commit()
    return {"ok": True, "deleted": len(messages)}


@router.get("/projects/{project_id}/documents/{doc_id}/ai/messages", response_model=list[ChatHistoryMessageResponse])
async def get_history(
    project_id: str,
    doc_id: str,
    thread_id: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _purge_ai_history(db, doc_id=doc_id)
    doc = await _require_document_access(project_id, doc_id, current_user.id, db)
    if not doc:
        return []

    query = (
        select(AIChatMessage, User.username)
        .join(User, AIChatMessage.user_id == User.id)
        .where(AIChatMessage.document_id == doc_id)
    )
    if thread_id:
        query = query.where(AIChatMessage.thread_id == _resolve_thread_id(doc_id, thread_id))

    result = await db.execute(query.order_by(AIChatMessage.created_at.asc(), AIChatMessage.id.asc()))
    rows = result.all()
    return [
        ChatHistoryMessageResponse(
            id=message.id,
            thread_id=_resolve_thread_id(doc_id, message.thread_id),
            role=message.role,
            content=message.content,
            action_type=message.action_type,
            action_prompt=message.action_prompt,
            quotes=_loads(message.quotes_json, None) if message.role == "user" else None,
            sources=_loads(message.quotes_json, None) if message.role == "assistant" else None,
            tool_calls=(
                (_loads(message.diff_json, {}).get("tool_calls") if message.diff_json else _loads(message.retry_action_json, {}).get("tool_calls"))
                if message.role == "assistant"
                else None
            ),
            diff=_loads(message.diff_json, None),
            retry_action=_loads(message.retry_action_json, None) if message.diff_json else None,
            accepted=_loads(message.accepted_json, []),
            rejected=_loads(message.rejected_json, []),
            provider=message.provider,
            model=message.model,
            status=message.status,
            error=message.error_message,
            from_user=username if message.role == "user" else None,
            created_at=message.created_at.isoformat() if message.created_at else None,
        )
        for message, username in rows
    ]


@router.patch("/projects/{project_id}/documents/{doc_id}/ai/messages/{message_id}")
async def update_message_review_state(
    project_id: str,
    doc_id: str,
    message_id: str,
    req: ReviewStateUpdateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _purge_ai_history(db, doc_id=doc_id)
    await _require_project(project_id, current_user.id, db, min_role="editor")
    result = await db.execute(
        select(AIChatMessage).where(
            AIChatMessage.id == message_id,
            AIChatMessage.document_id == doc_id,
        )
    )
    message = result.scalar_one_or_none()
    if not message:
        return {"ok": False}

    message.accepted_json = json.dumps(req.accepted)
    message.rejected_json = json.dumps(req.rejected)
    await db.commit()
    return {"ok": True}
