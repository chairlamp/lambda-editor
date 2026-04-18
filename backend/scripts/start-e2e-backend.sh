#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BACKEND_DIR="$ROOT/backend"

if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
  echo "backend/venv is missing. Set up the backend virtualenv before running E2E tests." >&2
  exit 1
fi

cd "$BACKEND_DIR"
source venv/bin/activate

export SECRET_KEY="e2e-secret-key"
export DATABASE_URL="sqlite+aiosqlite:////tmp/lambda_editor_e2e.db"
export REDIS_URL="redis://localhost:6379/0"
export USE_FAKE_REDIS="true"
export LLM_PROVIDER="fake"
export CORS_ORIGINS="http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5173,http://localhost:5173"

exec uvicorn app.main:app --host 127.0.0.1 --port 8000
