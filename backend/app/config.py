from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Literal


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    SECRET_KEY: str = "change-me"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/lambda_editor"
    REDIS_URL: str = "redis://localhost:6379/0"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_COOKIE_NAME: str = "lambda_access_token"
    REFRESH_TOKEN_COOKIE_NAME: str = "lambda_refresh_token"
    ACCESS_TOKEN_TTL_SECONDS: int = 60 * 15
    REFRESH_TOKEN_TTL_SECONDS: int = 60 * 60 * 24 * 7
    AUTH_COOKIE_SECURE: bool = False
    AUTH_COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"

    LLM_PROVIDER: str = "openai"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    GROQ_API_KEY: str = ""
    GROQ_MODEL: str = "openai/gpt-oss-20b"
    GROQ_BASE_URL: str = "https://api.groq.com/openai/v1"
    GOOGLE_TRANSLATE_API_URL: str = "https://translation.googleapis.com/language/translate/v2"
    GOOGLE_TRANSLATE_API_KEY: str = ""
    GOOGLE_TRANSLATE_SOURCE_LANGUAGE: str = "auto"

    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    UPLOADS_DIR: str = "backend/uploads"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    @property
    def llm_provider(self) -> str:
        provider = (self.LLM_PROVIDER or "openai").strip().lower()
        return provider if provider in {"openai", "groq"} else "openai"

    @property
    def llm_api_key(self) -> str:
        return self.GROQ_API_KEY if self.llm_provider == "groq" else self.OPENAI_API_KEY

    @property
    def llm_model(self) -> str:
        return self.GROQ_MODEL if self.llm_provider == "groq" else self.OPENAI_MODEL

    @property
    def llm_base_url(self) -> str:
        return self.GROQ_BASE_URL if self.llm_provider == "groq" else self.OPENAI_BASE_URL

    @property
    def llm_api_key_env_name(self) -> str:
        return "GROQ_API_KEY" if self.llm_provider == "groq" else "OPENAI_API_KEY"

settings = Settings()
