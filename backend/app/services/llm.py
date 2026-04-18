"""LLM provider abstraction.

All OpenAI-specific imports are confined to ``OpenAIProvider``.
Swapping providers only requires adding a new ``LLMProvider`` subclass and
updating the ``get_provider()`` factory — no changes needed in service modules.
"""
from __future__ import annotations

import asyncio
import json
import re
from abc import ABC, abstractmethod
from typing import AsyncIterator

from app.config import settings


class LLMProvider(ABC):
    """Minimal interface that AI service functions depend on."""

    @abstractmethod
    async def stream_completion(
        self,
        messages: list[dict],
        max_tokens: int = 2000,
    ) -> AsyncIterator[str]:
        """Yield text chunks from a streaming chat completion."""
        ...  # pragma: no cover

    @abstractmethod
    async def json_completion(
        self,
        messages: list[dict],
        max_tokens: int = 4000,
    ) -> str:
        """Return the full response text from a non-streaming JSON-mode completion."""
        ...  # pragma: no cover


class OpenAIProvider(LLMProvider):
    """Thin wrapper around the OpenAI async client."""

    def __init__(self) -> None:
        from openai import AsyncOpenAI  # import deferred so tests can mock easily
        self._client = AsyncOpenAI(
            api_key=settings.llm_api_key,
            base_url=settings.llm_base_url,
        )

    async def stream_completion(
        self,
        messages: list[dict],
        max_tokens: int = 2000,
    ) -> AsyncIterator[str]:
        stream = await self._client.chat.completions.create(
            model=settings.llm_model,
            messages=messages,
            stream=True,
            max_tokens=max_tokens,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta

    async def json_completion(
        self,
        messages: list[dict],
        max_tokens: int = 4000,
    ) -> str:
        response = await self._client.chat.completions.create(
            model=settings.llm_model,
            messages=messages,
            stream=False,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content or "{}"


class FakeProvider(LLMProvider):
    """Deterministic provider used by browser E2E tests and local offline demos."""

    async def stream_completion(
        self,
        messages: list[dict],
        max_tokens: int = 2000,
    ) -> AsyncIterator[str]:
        prompt = _last_user_content(messages)
        response = (
            "Fake AI summary: the introduction has been tightened and the document remains ready for review."
            if "summarize" in prompt.lower()
            else "Fake AI response: the requested LaTeX edit is ready for review."
        )
        for idx in range(0, min(len(response), max_tokens), 24):
            yield response[idx: idx + 24]
            await asyncio.sleep(0)

    async def json_completion(
        self,
        messages: list[dict],
        max_tokens: int = 4000,
    ) -> str:
        prompt = _last_user_content(messages)
        document = _extract_document(prompt)
        old_text = _choose_old_text(document)
        new_text = _rewrite_text(old_text)
        return json.dumps(
            {
                "explanation": "Deterministic fake AI suggestion generated for end-to-end testing.",
                "changes": [
                    {
                        "id": "c1",
                        "description": "Revise the introduction wording.",
                        "old_text": old_text,
                        "new_text": new_text,
                    }
                ],
            }
        )


def _last_user_content(messages: list[dict]) -> str:
    for message in reversed(messages):
        if message.get("role") == "user":
            return str(message.get("content") or "")
    return ""


def _extract_document(prompt: str) -> str:
    match = re.search(r"```latex\n(?P<doc>.*?)\n```", prompt, re.DOTALL)
    if not match:
        return ""
    return match.group("doc")


def _choose_old_text(document: str) -> str:
    for preferred in ("\\section{Introduction}", "Introduction", "Your content here."):
        for line in document.splitlines():
            if preferred in line:
                return line

    for line in document.splitlines():
        if line.strip():
            return line
    return ""


def _rewrite_text(old_text: str) -> str:
    if not old_text:
        return "AI-reviewed content"
    if "\\section{Introduction}" in old_text:
        return old_text.replace("Introduction", "Overview", 1)
    if "Introduction" in old_text:
        return old_text.replace("Introduction", "Overview", 1)
    if "Your content here." in old_text:
        return old_text.replace("Your content here.", "Your content now includes an AI-reviewed update.", 1)
    return f"{old_text} (AI reviewed)"


# ---------------------------------------------------------------------------
# Module-level singleton — replace this to swap providers globally.
# ---------------------------------------------------------------------------

_provider: LLMProvider | None = None


def get_provider() -> LLMProvider:
    """Return the active LLM provider, initialising it on first call."""
    global _provider
    if _provider is None:
        _provider = FakeProvider() if settings.llm_provider == "fake" else OpenAIProvider()
    return _provider


def set_provider(provider: LLMProvider) -> None:
    """Override the active provider (useful for tests or alternative backends)."""
    global _provider
    _provider = provider
