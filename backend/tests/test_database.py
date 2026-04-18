from app.database import _normalize_database_url


def test_normalize_render_postgres_connection_string():
    assert _normalize_database_url("postgresql://user:pass@db.internal:5432/lambda_editor") == (
        "postgresql+asyncpg://user:pass@db.internal:5432/lambda_editor"
    )


def test_preserve_existing_asyncpg_connection_string():
    assert _normalize_database_url("postgresql+asyncpg://user:pass@db.internal:5432/lambda_editor") == (
        "postgresql+asyncpg://user:pass@db.internal:5432/lambda_editor"
    )
