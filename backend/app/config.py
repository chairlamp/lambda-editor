from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


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

    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4o"
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    GOOGLE_TRANSLATE_API_URL: str = "https://translation.googleapis.com/language/translate/v2"
    GOOGLE_TRANSLATE_API_KEY: str = ""
    GOOGLE_TRANSLATE_SOURCE_LANGUAGE: str = "auto"

    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"
    UPLOADS_DIR: str = "backend/uploads"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

settings = Settings()
