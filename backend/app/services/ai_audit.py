from __future__ import annotations

from collections.abc import Sequence

from app.config import settings

AI_STATUS_SUBMITTED = "submitted"
AI_STATUS_COMPLETED = "completed"
AI_STATUS_FAILED = "failed"
AI_STATUS_CANCELLED = "cancelled"

TRANSLATION_PROVIDER = "google_translate"
TRANSLATION_MODEL = "translation_v2"


def infer_provider_model(
    action_type: str | None = None,
    tool_calls: Sequence[str] | None = None,
) -> tuple[str, str]:
    tool_names = {name for name in (tool_calls or []) if isinstance(name, str) and name}
    if action_type == "translate" or tool_names == {"translate_text"}:
        return TRANSLATION_PROVIDER, TRANSLATION_MODEL
    return settings.llm_provider, settings.llm_model
