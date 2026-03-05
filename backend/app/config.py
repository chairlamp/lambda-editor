from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    SECRET_KEY: str = "change-me"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/lambda_editor"
    REDIS_URL: str = "redis://localhost:6379/0"
    SESSION_COOKIE_NAME: str = "lambda_session"
    SESSION_TTL_SECONDS: int = 60 * 60 * 24 * 7
    SESSION_COOKIE_SECURE: bool = False

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"

    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

settings = Settings()
