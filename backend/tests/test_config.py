from app.config import Settings


def test_default_llm_provider_uses_openai_env():
    settings = Settings(
        LLM_PROVIDER="openai",
        OPENAI_API_KEY="openai-key",
        OPENAI_MODEL="gpt-4o",
        OPENAI_BASE_URL="https://api.openai.com/v1",
    )

    assert settings.llm_provider == "openai"
    assert settings.llm_api_key == "openai-key"
    assert settings.llm_model == "gpt-4o"
    assert settings.llm_base_url == "https://api.openai.com/v1"
    assert settings.llm_api_key_env_name == "OPENAI_API_KEY"


def test_groq_llm_provider_uses_groq_env():
    settings = Settings(
        LLM_PROVIDER="groq",
        OPENAI_API_KEY="unused-openai-key",
        GROQ_API_KEY="groq-key",
        GROQ_MODEL="openai/gpt-oss-20b",
        GROQ_BASE_URL="https://api.groq.com/openai/v1",
    )

    assert settings.llm_provider == "groq"
    assert settings.llm_api_key == "groq-key"
    assert settings.llm_model == "openai/gpt-oss-20b"
    assert settings.llm_base_url == "https://api.groq.com/openai/v1"
    assert settings.llm_api_key_env_name == "GROQ_API_KEY"
