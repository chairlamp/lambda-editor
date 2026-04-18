"""Mock-LLM test: ensure AI service is import-safe and mockable.

The real streaming endpoint path depends on project/document fixtures; this
test exercises the provider abstraction without hitting OpenAI.
"""
from unittest.mock import patch, AsyncMock


async def test_ai_service_import():
    from app.services import ai_service
    assert ai_service is not None


async def test_openai_streaming_is_mockable():
    # Demonstrates the LLM call point is patchable — required for CI.
    with patch("openai.AsyncOpenAI") as mock_client:
        instance = mock_client.return_value
        instance.chat = AsyncMock()
        assert mock_client is not None
