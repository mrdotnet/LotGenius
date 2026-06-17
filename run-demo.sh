#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Lot Genius — one-command LOCAL DEMO launcher.
#
# Brings up the whole stack on real models (Azure OpenAI text-embedding-3-large +
# gpt-5, reusing the existing account) and opens TWO browser UIs:
#   • Appraiser chat UI  (Teams stand-in)        → http://localhost:8000
#   • Admin review console (classification/SC4)  → http://localhost:5173
#
# Prereqs (one-time): Docker running, src/orchestrator/.venv created, AOAI creds in
# local-dev/.env.local. First run will seed/load the demo DBs (the prod DB load hits
# real AOAI, ~6 min once); later runs skip straight to launch.
#
# Ctrl-C tears everything down.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLIENT_PORT="${CLIENT_PORT:-8000}"
ADMIN_API_PORT="${ADMIN_API_PORT:-8787}"
ADMIN_WEB_PORT="${ADMIN_WEB_PORT:-5173}"
SEAM="$ROOT/local-dev/wired/target/debug/lotgenius-mcp"
PGEXEC=(docker exec lotgenius-pg-local psql -U lotgenius -tAc)

log() { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

PIDS=()
cleanup() {
  echo; log "stopping demo…"
  for p in "${PIDS[@]:-}"; do
    [ -n "$p" ] || continue
    pkill -P "$p" 2>/dev/null || true   # children (vite/uvicorn workers)
    kill "$p" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

dbcount() { "${PGEXEC[@]}" "SELECT count(*) FROM lot_vectors;" -d "$1" 2>/dev/null || echo 0; }
wait_http() { # url, label, tries
  for _ in $(seq 1 "${3:-60}"); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done
  warn "$2 did not come up at $1 in time"; return 1
}

# ── 0. prereqs ───────────────────────────────────────────────────────────────
command -v docker >/dev/null || die "Docker not found"
[ -f "$ROOT/local-dev/.env.local" ] || die "local-dev/.env.local missing (AOAI creds)"
[ -x "$ROOT/src/orchestrator/.venv/bin/python" ] || die "orchestrator venv missing — cd src/orchestrator && python3.11 -m venv .venv && . .venv/bin/activate && pip install -e '.[test,web]'"

# ── 1. pgvector ──────────────────────────────────────────────────────────────
log "starting pgvector…"
docker compose -f "$ROOT/local-dev/docker-compose.yml" up -d >/dev/null
for _ in $(seq 1 30); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' lotgenius-pg-local 2>/dev/null)" = healthy ] && break; sleep 1
done

# ── 2. build the Rust binaries (fast once cached) ────────────────────────────
log "building Rust seam + admin shim (cached after first run)…"
( cd "$ROOT/local-dev/wired" && cargo build --features runtime -q ) || die "wired seam build failed"
( cd "$ROOT/src/admin-shim" && cargo build -q ) || die "admin-shim build failed"

# ── 3. ensure demo data is loaded ────────────────────────────────────────────
if [ "$(dbcount lotgenius)" -lt 1 ]; then
  log "loading base local DB (384-dim, offline)…"
  ( cd "$ROOT/local-dev/lotgenius-runtime-rs" && cargo run -q --bin load_pg ) || warn "base load issue"
fi
if [ "$(dbcount lotgenius_rs_prod)" -lt 1 ]; then
  log "loading prod DB via real AOAI embeddings (one-time, ~6 min)…"
  set -a; . "$ROOT/local-dev/.env.local"; set +a
  ( cd "$ROOT/local-dev/lotgenius-runtime-rs" && cargo run -q --bin load_pg_prod -- --limit 1500 ) || die "prod load failed"
fi
if [ "$(dbcount lotgenius_admin)" -lt 1 ]; then
  log "seeding admin review DB (9 strangers)…"
  ( cd "$ROOT/src/admin-shim" && cargo run -q --bin seed_admin ) || die "admin seed failed"
fi
log "data ready — base:$(dbcount lotgenius)  prod:$(dbcount lotgenius_rs_prod)  admin:$(dbcount lotgenius_admin)"

# ── 4. appraiser chat UI (orchestrator web server, real models) ──────────────
log "starting appraiser chat UI on :$CLIENT_PORT …"
"$ROOT/src/orchestrator/.venv/bin/python" -c "import uvicorn, fastapi" 2>/dev/null \
  || ( cd "$ROOT/src/orchestrator" && ./.venv/bin/pip install -q -e '.[web]' )
( cd "$ROOT/src/orchestrator"
  set -a; . "$ROOT/local-dev/.env.local"; set +a
  export LOTGENIUS_PROFILE=prod
  export LOTGENIUS_MCP_SERVER_COMMAND="$SEAM"
  export PORT="$CLIENT_PORT"
  exec ./.venv/bin/python -m lotgenius_orchestrator.webapp
) & PIDS+=($!)

# ── 5. admin shim BE + recompute ─────────────────────────────────────────────
log "starting admin shim on :$ADMIN_API_PORT …"
( cd "$ROOT/src/admin-shim"
  export ADMIN_SHIM_ADDR="127.0.0.1:$ADMIN_API_PORT" PGDATABASE_ADMIN=lotgenius_admin
  exec cargo run -q --bin admin-shim
) & PIDS+=($!)
wait_http "http://127.0.0.1:$ADMIN_API_PORT/admin/review?limit=1" "admin shim" 40 || true
log "computing classification disagreement…"
curl -sf -X POST "http://127.0.0.1:$ADMIN_API_PORT/admin/recompute" >/dev/null && log "recompute done" || warn "recompute failed"

# ── 6. admin web console ─────────────────────────────────────────────────────
log "starting admin web console on :$ADMIN_WEB_PORT …"
( cd "$ROOT/admin-web"
  [ -d node_modules ] || npm install --silent
  export VITE_USE_MOCK=false VITE_ADMIN_API="http://localhost:$ADMIN_API_PORT"
  exec npm run dev -- --port "$ADMIN_WEB_PORT" --strictPort
) & PIDS+=($!)

# ── 7. wait + open both UIs ──────────────────────────────────────────────────
wait_http "http://localhost:$CLIENT_PORT/healthz" "appraiser UI" 60 || true
wait_http "http://localhost:$ADMIN_WEB_PORT" "admin UI" 60 || true
if [ -z "${NO_OPEN:-}" ]; then
  OPEN=$(command -v open || command -v xdg-open || true)
  [ -n "$OPEN" ] && { "$OPEN" "http://localhost:$CLIENT_PORT" 2>/dev/null || true; "$OPEN" "http://localhost:$ADMIN_WEB_PORT" 2>/dev/null || true; }
fi

cat <<EOF

  ┌────────────────────────────────────────────────────────────┐
  │  Lot Genius — local demo is up (real gpt-5 + embeddings)    │
  │                                                            │
  │  Appraiser chat  →  http://localhost:$CLIENT_PORT                    │
  │  Admin review    →  http://localhost:$ADMIN_WEB_PORT                    │
  │                                                            │
  │  Ctrl-C to stop everything.                                │
  └────────────────────────────────────────────────────────────┘
EOF
wait
