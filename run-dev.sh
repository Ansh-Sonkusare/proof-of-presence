#!/usr/bin/env bash
#
# run-dev.sh — spin up the entire PBL attendance tracker stack locally.
#
#   ./run-dev.sh             start everything (Postgres, chain node,
#                             contracts, backend, frontend)
#   ./run-dev.sh --force     start, but first kill whatever occupies a
#                             needed port (backend/frontend only — never
#                             the chain or DB unless it is ours)
#   ./run-dev.sh stop        stop what this script started
#   ./run-dev.sh stop --db   also stop the Postgres container it created
#   ./run-dev.sh status      show what is running
#
# Everything is backgrounded; logs live in ./logs/. Re-running is safe:
# services already up are reused, contracts are re-deployed and the two
# addresses are rewritten into backend/.env automatically.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
LOGS="$ROOT/logs"
STATE="$LOGS/run-dev.state"
ENVFILE="$ROOT/backend/.env"

CHAIN_PORT=8545
BACKEND_PORT=3001
FRONTEND_PORT=3000
DB_PORT=5432
DB_CONTAINER="pbl-pg-dev"
DB_NAME="attendance_tracker"
DB_USER="user"
DB_PASS="password"

FORCE=0
STOP_DB=0

mkdir -p "$LOGS"

say()  { printf '==> %s\n' "$*"; }
warn() { printf '!!  %s\n' "$*" >&2; }
die()  { warn "$*"; exit 1; }
die2() { warn "$1"; warn "$2"; exit 1; }

port_used()   { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | grep -q .; }
pid_on_port() { lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true; }
pid_owner()   { pid_on_port "$1" | xargs ps -o comm= -p  2>/dev/null || echo unknown; }

kill_port() {
  local port="$1" pids
  pids="$(pid_on_port "$port")"
  [ -n "$pids" ] && kill $pids 2>/dev/null || true
  sleep 1
  pids="$(pid_on_port "$port")"
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
}

log_state() { printf '%s\n' "$1" >> "$STATE"; }

clear_state() { : > "$STATE"; }

state_lines() { [ -f "$STATE" ] && grep -v '^$' "$STATE" || true; }

wait_rpc() {
  local port="$1" i=0
  while [ "$i" -lt 60 ]; do
    if curl -s -m 1 -X POST -H 'Content-Type: application/json' \
      --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
      "http://127.0.0.1:$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  return 1
}

wait_listen() {
  local port="$1" i=0
  while [ "$i" -lt 40 ]; do
    port_used "$port" && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

wait_pg_docker() {
  local i=0
  while [ "$i" -lt 60 ]; do
    docker exec "$DB_CONTAINER" pg_isready -U "$DB_USER" -d "$DB_NAME" >/dev/null 2>&1 && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

is_address() { [[ "$1" =~ ^0x[0-9a-fA-F]{40}$ ]]; }

write_env_addresses() {
  local reg="$1" fwd="$2"
  awk -v reg="$reg" -v fwd="$fwd" '
    { if ($0 ~ /^ATTENDANCE_REGISTRY_ADDRESS=/)    { print "ATTENDANCE_REGISTRY_ADDRESS=\"" reg "\""; r=1; next }
      if ($0 ~ /^MINIMAL_FORWARDER_ADDRESS=/)       { print "MINIMAL_FORWARDER_ADDRESS=\"" fwd "\""; f=1; next }
      print }
    END { if (!r) print "ATTENDANCE_REGISTRY_ADDRESS=\"" reg "\""
          if (!f) print "MINIMAL_FORWARDER_ADDRESS=\"" fwd "\"" }
  ' "$ENVFILE" > "$ENVFILE.new" && mv "$ENVFILE.new" "$ENVFILE"
}

ensure_deps() {
  [ -x "$ROOT/node_modules/.bin/hardhat" ] || {
    say "Installing workspace dependencies (first run) ..."
    ( cd "$ROOT" && npm install )
  }
}

start_chain() {
  if port_used "$CHAIN_PORT"; then
    say "Chain node already listening on :$CHAIN_PORT (reusing)"
    log_state "node|$CHAIN_PORT|reused"
  else
    say "Starting Hardhat node on :$CHAIN_PORT ..."
    ( cd "$ROOT/contracts" && "$ROOT/node_modules/.bin/hardhat" node ) \
      > "$LOGS/hardhat.log" 2>&1 &
    log_state "node|$CHAIN_PORT|$!"
    wait_rpc "$CHAIN_PORT" || die "Hardhat node failed to start (see $LOGS/hardhat.log)"
  fi
}

deploy_contracts() {
  say "Deploying contracts ..."
  local out reg fwd
  out="$(cd "$ROOT/contracts" && "$ROOT/node_modules/.bin/hardhat" run scripts/deploy.js --network localhost 2>&1)" \
    || die2 "Contract deployment failed." "$out"
  reg="$(printf '%s\n' "$out" | grep -E '^AttendanceRegistry:'  | awk '{print $2}' | tr -d '\r' || true)"
  fwd="$(printf '%s\n' "$out" | grep -E '^ERC2771Forwarder:' | awk '{print $2}' | tr -d '\r' || true)"
  is_address "$reg" || die2 "Could not parse AttendanceRegistry address from deploy output." "$out"
  is_address "$fwd" || die2 "Could not parse ERC2771Forwarder address from deploy output." "$out"
  write_env_addresses "$reg" "$fwd"
  say "  AttendanceRegistry : $reg"
  say "  ERC2771Forwarder   : $fwd"
  say "  wrote both into $ENVFILE"
}

start_db() {
  local tracked
  tracked="$( [ -f "$STATE" ] && grep '^db|' "$STATE" || true )"
  if port_used "$DB_PORT"; then
    say "Postgres already listening on :$DB_PORT (reusing)"
    [ -z "$tracked" ] && log_state "db|$DB_PORT|local"
    return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    die "Postgres is not reachable on :$DB_PORT and Docker is not running."
  fi
  say "Starting Postgres container '$DB_CONTAINER' ..."
  if [ -n "$(docker ps -aq -f name="^/$DB_CONTAINER$")" ]; then
    docker start "$DB_CONTAINER" >/dev/null
  else
    docker run -d --name "$DB_CONTAINER" \
      -e POSTGRES_USER="$DB_USER" \
      -e POSTGRES_PASSWORD="$DB_PASS" \
      -e POSTGRES_DB="$DB_NAME" \
      -p "$DB_PORT:5432" \
      -v "$DB_CONTAINER-data:/var/lib/postgresql/data" \
      postgres:16-alpine >/dev/null
  fi
  [ -z "$tracked" ] && log_state "db|$DB_PORT|docker"
  wait_pg_docker || die "Postgres container did not become ready"
  say "  Postgres ready on :$DB_PORT (db=$DB_NAME user=$DB_USER)"
}

prepare_db() {
  say "Applying Prisma schema + seeding ..."
  ( set -a; source "$ENVFILE"; set +a
    cd "$ROOT/backend"
    "$ROOT/node_modules/.bin/prisma" db push
    "$ROOT/node_modules/.bin/tsx" prisma/seed.ts
  ) || die "DB setup failed — is a Postgres on :$DB_PORT set up with db=$DB_NAME, user=$DB_USER?"
}

start_backend() {
  local owner
  if port_used "$BACKEND_PORT"; then
    owner="$(pid_owner "$BACKEND_PORT")"
    if [ "$FORCE" -eq 1 ]; then
      say "Port :$BACKEND_PORT owned by '$owner' — killing (--force)"
      kill_port "$BACKEND_PORT"
    else
      die "Port :$BACKEND_PORT is in use by '$owner'. Free it or re-run with --force."
    fi
  fi
  say "Starting backend on :$BACKEND_PORT ..."
  ( set -a; source "$ENVFILE"; set +a
    cd "$ROOT/backend"
    exec "$ROOT/node_modules/.bin/tsx" watch src/index.ts
  ) > "$LOGS/backend.log" 2>&1 &
  log_state "backend|$BACKEND_PORT|$!"
  wait_listen "$BACKEND_PORT" || warn "backend did not bind :$BACKEND_PORT yet (see $LOGS/backend.log)"
}

start_frontend() {
  local owner
  if port_used "$FRONTEND_PORT"; then
    owner="$(pid_owner "$FRONTEND_PORT")"
    if [ "$FORCE" -eq 1 ]; then
      say "Port :$FRONTEND_PORT owned by '$owner' — killing (--force)"
      kill_port "$FRONTEND_PORT"
    else
      die "Port :$FRONTEND_PORT is in use by '$owner'. Free it or re-run with --force."
    fi
  fi
  say "Starting frontend on :$FRONTEND_PORT ..."
  ( cd "$ROOT/frontend"
    exec "$ROOT/node_modules/.bin/vite" dev --port "$FRONTEND_PORT" --strictPort
  ) > "$LOGS/frontend.log" 2>&1 &
  log_state "frontend|$FRONTEND_PORT|$!"
  wait_listen "$FRONTEND_PORT" || warn "frontend did not bind :$FRONTEND_PORT yet (see $LOGS/frontend.log)"
}

print_summary() {
  say "Stack is up."
  cat <<EOF

  Frontend   http://localhost:$FRONTEND_PORT
  Backend    http://localhost:$BACKEND_PORT   (Swagger at /docs)
  Chain RPC  http://127.0.0.1:$CHAIN_PORT
  Postgres   localhost:$DB_PORT/$DB_NAME

  Logins (password123):
    admin@pbl.edu     faculty@pbl.edu
    student1@pbl.edu  student2@pbl.edu

  Logs:  $LOGS/*.log
  Stop:  ./run-dev.sh stop   (add --db to also stop the Postgres container)
EOF
}

status() {
  local lines type port kind extra note
  lines="$(state_lines)"
  if [ -z "$lines" ]; then
    say "Nothing started by this script. Ports now:"
    for p in "$CHAIN_PORT" "$BACKEND_PORT" "$FRONTEND_PORT" "$DB_PORT"; do
      if port_used "$p"; then echo "  :$p listening"; else echo "  :$p free"; fi
    done
    return 0
  fi
  printf '%-8s %-6s %-8s %s\n' 'SERVICE' 'PORT' 'STATE' 'NOTES'
  while IFS='|' read -r type port kind extra; do
    note=""
    [ "$kind" = "reused" ] && note="(reused existing)"
    [ "$kind" = "local"  ] && note="(native Postgres)"
    [ "$kind" = "docker" ] && note="(container $DB_CONTAINER)"
    if port_used "$port"; then
      printf '%-8s %-6s %-8s %s\n' "$type" "$port" "up" "$note"
    else
      printf '%-8s %-6s %-8s %s\n' "$type" "$port" "DOWN" "$note"
    fi
  done <<< "$lines"
}

stop() {
  local tmp type port kind extra pid
  if [ ! -f "$STATE" ]; then
    say "Nothing to stop (no state file)."
    return 0
  fi
  say "Stopping services started by this script ..."
  tmp="$STATE.tmp"
  : > "$tmp"
  while IFS='|' read -r type port kind extra; do
    case "$type" in
      node|backend|frontend)
        if [ "$kind" = "reused" ]; then
          say "  $type :$port was reused — leaving it alone"
          echo "$type|$port|$kind" >> "$tmp"
        else
          pid="${kind:-}"
          [ -n "$pid" ] && [ "$pid" != "0" ] && kill "$pid" 2>/dev/null || true
          say "  stopping $type on :$port"
          kill_port "$port"
        fi
        ;;
      db)
        if [ "$STOP_DB" -eq 1 ]; then
          if [ "$kind" = "docker" ]; then
            say "  stopping Postgres container '$DB_CONTAINER'"
            docker stop "$DB_CONTAINER" >/dev/null 2>&1 || true
          else
            warn "Postgres on :$port is native — not managed by this script; stop it yourself."
            echo "$type|$port|$kind" >> "$tmp"
          fi
        else
          echo "$type|$port|$kind" >> "$tmp"
        fi
        ;;
      *) echo "$type|$port|$kind" >> "$tmp" ;;
    esac
  done < "$STATE"
  mv "$tmp" "$STATE"
  [ -s "$STATE" ] || rm -f "$STATE"
  say "Stopped."
}

usage() {
  sed -n '2,14p' "$0"
}

case "${1:-start}" in
  stop|down)
    shift
    for a in "$@"; do [ "$a" = "--db" ] && STOP_DB=1; done
    stop
    exit 0
    ;;
  status)
    status
    exit 0
    ;;
  -h|--help|help)
    usage
    exit 0
    ;;
esac

for a in "$@"; do case "$a" in --force) FORCE=1 ;; *) ;; esac; done

[ -f "$STATE" ] && {
  say "Previous run detected — stopping stale services first."
  stop
}

ensure_deps
start_chain
deploy_contracts
start_db
prepare_db
start_backend
start_frontend
print_summary