#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
POSTGRES_CONTAINER="lambda-editor-postgres"
REDIS_CONTAINER="lambda-editor-redis"
POSTGRES_PORT="5432"
REDIS_PORT="6379"
POSTGRES_DB="lambda_editor"
POSTGRES_USER="postgres"
POSTGRES_PASSWORD="postgres"

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker is required for start.sh because it now provisions PostgreSQL and Redis."
    exit 1
  fi
}

ensure_container() {
  local name="$1"
  local image="$2"
  shift 2
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" >/dev/null
  else
    docker run -d --name "$name" "$@" "$image" >/dev/null
  fi
}

wait_for_postgres() {
  until docker exec "$POSTGRES_CONTAINER" pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
    sleep 1
  done
}

wait_for_redis() {
  until docker exec "$REDIS_CONTAINER" redis-cli ping >/dev/null 2>&1; do
    sleep 1
  done
}

echo "Starting Lambda Editor..."
echo ""

echo "[1/4] Starting PostgreSQL on localhost:${POSTGRES_PORT}"
ensure_docker
ensure_container "$POSTGRES_CONTAINER" postgres:16-alpine \
  -e POSTGRES_DB="$POSTGRES_DB" \
  -e POSTGRES_USER="$POSTGRES_USER" \
  -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  -p "$POSTGRES_PORT:5432"
wait_for_postgres

echo "[2/4] Starting Redis on localhost:${REDIS_PORT}"
ensure_container "$REDIS_CONTAINER" redis:7-alpine -p "$REDIS_PORT:6379"
wait_for_redis

echo "[3/4] Starting FastAPI backend on http://localhost:8000"
cd "$ROOT/backend"
source venv/bin/activate
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

sleep 1

echo "[4/4] Starting React frontend on http://localhost:5173"
cd "$ROOT/frontend"
npm install
npm run dev &
FRONTEND_PID=$!

echo ""
echo "  PostgreSQL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT}/${POSTGRES_DB}"
echo "  Redis:      redis://localhost:${REDIS_PORT}/0"
echo "  Backend:    http://localhost:8000"
echo "  Frontend:   http://localhost:5173"
echo "  API docs:   http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop the frontend and backend. Docker services stay running."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo 'Stopped app servers.'" SIGINT SIGTERM
wait
