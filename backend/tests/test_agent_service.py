from app.services import agent_service
from app.config import settings


def test_openai_function_tool_uses_flat_shape(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")

    tool = agent_service._function_tool(  # noqa: SLF001
        "research_topic",
        "Research docs.",
        {"type": "object", "properties": {}, "required": []},
    )

    assert tool == {
        "type": "function",
        "name": "research_topic",
        "description": "Research docs.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }


def test_groq_function_tool_uses_flat_shape(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "groq")

    tool = agent_service._function_tool(  # noqa: SLF001
        "research_topic",
        "Research docs.",
        {"type": "object", "properties": {}, "required": []},
    )

    assert tool == {
        "type": "function",
        "name": "research_topic",
        "description": "Research docs.",
        "parameters": {"type": "object", "properties": {}, "required": []},
    }


def test_groq_uses_browser_search_tool_name(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "groq")
    assert agent_service._search_tool_type() == "browser_search"  # noqa: SLF001


def test_openai_uses_web_search_tool_name(monkeypatch):
    monkeypatch.setattr(settings, "LLM_PROVIDER", "openai")
    assert agent_service._search_tool_type() == "web_search"  # noqa: SLF001
