"""LLM provider abstraction.

All OpenAI-specific imports are confined to ``OpenAIProvider``.
Swapping providers only requires adding a new ``LLMProvider`` subclass and
updating the ``get_provider()`` factory — no changes needed in service modules.
"""
from __future__ import annotations

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


# ---------------------------------------------------------------------------
# Module-level singleton — replace this to swap providers globally.
# ---------------------------------------------------------------------------

_provider: LLMProvider | None = None


def get_provider() -> LLMProvider:
    """Return the active LLM provider, initialising it on first call."""
    global _provider
    if _provider is None:
        _provider = OpenAIProvider()
    return _provider


def set_provider(provider: LLMProvider) -> None:
    """Override the active provider (useful for tests or alternative backends)."""
    global _provider
    _provider = provider
