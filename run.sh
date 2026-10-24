#!/usr/bin/env bash
# Starts the full stack (TimescaleDB, ingestion, FastAPI, frontend) with Docker Compose.
# Works on Linux, macOS and Git Bash on Windows. Run ./run.sh --help for options.
set -euo pipefail

cd "$(dirname "$0")"

usage() {
  cat <<'EOF'
Usage: ./run.sh [option]

  (no option)   build images if missing, then start all services
  --build       rebuild images, then start all services
  --dev         start with hot reload for backend and frontend (Vite on :5173)
  --stop        stop and remove the containers (database data is kept)
  --logs        follow logs from all services
  --reset-db    delete the database volume and reload data from Elexon (asks first)
  --help        show this message
EOF
}

info() { printf '==> %s\n' "$*"; }
fail() { printf 'Error: %s\n' "$*" >&2; exit 1; }

check_docker() {
  command -v docker >/dev/null 2>&1 || fail "Docker is not installed or not on PATH. See https://docs.docker.com/get-docker/"
  docker info >/dev/null 2>&1 || fail "Docker is installed but the daemon is not running. Start Docker (Docker Desktop on macOS/Windows) and try again."

  # Compose v2 is required for 'up --wait'. Prefer the plugin, fall back to a standalone v2 binary.
  if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
  elif command -v docker-compose >/dev/null 2>&1 && docker-compose version --short 2>/dev/null | grep -q '^v\?2'; then
    COMPOSE=(docker-compose)
  else
    fail "Docker Compose v2 is required. Install the Compose plugin: https://docs.docker.com/compose/install/"
  fi
}

ensure_env_file() {
  if [[ ! -f .env ]]; then
    [[ -f .env.example ]] || fail ".env.example is missing; cannot create .env"
    cp .env.example .env
    info "Created .env from .env.example (edit it to change ports or credentials)"
  fi
}

# Reads one KEY=value from .env without sourcing it, so nothing else is evaluated or printed.
env_value() {
  local key=$1 default=$2 value
  value=$(grep -E "^${key}=" .env | tail -n 1 | cut -d '=' -f 2- | tr -d '\r' || true)
  printf '%s' "${value:-$default}"
}

start_dev() {
  info "Starting dev stack with hot reload (first run installs frontend dependencies; this can take a minute)"
  local files=(-f docker-compose.yml -f docker-compose.dev.yml)
  # Name services explicitly so the production nginx "frontend" is not started.
  if ! "${COMPOSE[@]}" "${files[@]}" up -d --wait db ingest backend frontend-dev; then
    "${COMPOSE[@]}" "${files[@]}" logs --tail 30 ingest backend frontend-dev >&2 || true
    fail "dev services did not start. Check the output above, or run ./run.sh --logs"
  fi

  info "Dev stack is running; edits to backend/ and frontend/ reload automatically"
  printf '    Dashboard:  http://localhost:%s\n' "$(env_value FRONTEND_DEV_PORT 5173)"
  printf '    API:        http://localhost:%s/api/health\n' "$(env_value BACKEND_PORT 8000)"
  printf '    Stop with:  ./run.sh --stop\n'
}

start() {
  local up_args=(up -d --wait)
  if [[ ${1:-} == "--build" ]]; then
    up_args+=(--build)
  fi

  info "Starting services (the first run downloads January 2026 data from Elexon; this can take a minute)"
  if ! "${COMPOSE[@]}" "${up_args[@]}"; then
    printf '\n' >&2
    "${COMPOSE[@]}" ps -a >&2 || true
    printf '\nRecent logs from ingest and backend:\n' >&2
    "${COMPOSE[@]}" logs --tail 30 ingest backend >&2 || true
    fail "services did not start. Check the output above, or run ./run.sh --logs. If a port is already in use, change FRONTEND_PORT, BACKEND_PORT or POSTGRES_PORT in .env"
  fi

  info "All services are healthy"
  printf '    Dashboard:  http://localhost:%s\n' "$(env_value FRONTEND_PORT 3000)"
  printf '    API:        http://localhost:%s/api/health\n' "$(env_value BACKEND_PORT 8000)"
  printf '    Stop with:  ./run.sh --stop\n'
}

stop() {
  info "Stopping services (database data is kept)"
  "${COMPOSE[@]}" -f docker-compose.yml -f docker-compose.dev.yml down
}

reset_db() {
  local project volume answer
  project=$("${COMPOSE[@]}" config 2>/dev/null | sed -n 's/^name: *//p' | head -n 1)
  [[ -n $project ]] || fail "could not read the Compose project name"
  volume=$(docker volume ls -q \
    --filter "label=com.docker.compose.project=${project}" \
    --filter "label=com.docker.compose.volume=db-data")

  cat <<EOF

WARNING: this permanently deletes the database volume (${volume:-none found}) and every row in it.
The data is downloaded again from Elexon when the services restart.

EOF
  printf "Type 'reset' to continue, or anything else to cancel: "
  read -r answer || answer=""
  [[ $answer == "reset" ]] || { info "Cancelled; nothing was changed"; exit 0; }

  "${COMPOSE[@]}" down
  if [[ -n $volume ]]; then
    docker volume rm "$volume" >/dev/null
    info "Deleted volume $volume"
  else
    info "No database volume found; starting fresh"
  fi
  start
}

case "${1:-}" in
  "") check_docker; ensure_env_file; start ;;
  --build) check_docker; ensure_env_file; start --build ;;
  --dev) check_docker; ensure_env_file; start_dev ;;
  --stop) check_docker; stop ;;
  --logs) check_docker; "${COMPOSE[@]}" -f docker-compose.yml -f docker-compose.dev.yml logs -f --tail 100 ;;
  --reset-db) check_docker; ensure_env_file; reset_db ;;
  -h | --help) usage ;;
  *) usage >&2; fail "unknown option '$1'" ;;
esac
