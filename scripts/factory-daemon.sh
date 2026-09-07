#!/usr/bin/env bash
set -euo pipefail

# Shared env for this repo: <host-base>/.env.d/<owner>/<repo>.env, derived from the git remote.
_remote="$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." config --get remote.origin.url 2>/dev/null || true)"
_remote="${_remote%.git}"; _remote="${_remote#git@github.com:}"; _remote="${_remote#https://github.com/}"
set -a
[ -n "$_remote" ] && source "${HATCH_HOST_BASE_DIR:-$HOME/.hatch-hosts}/.env.d/${_remote}.env" 2>/dev/null || true
set +a
unset _remote

# Ensure inline node -e scripts can resolve workspace packages (pg, etc.)
export NODE_PATH="${NODE_PATH:-}:$(cd "$(dirname "$0")/.." && pwd)/node_modules"

FACTORY_ID="${1:?Usage: factory-daemon.sh <factory-id>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

BASE_DIR="${HATCH_HOST_BASE_DIR:-$HOME/.hatch-hosts}"
PID_DIR="$BASE_DIR/$FACTORY_ID/pid"
PID_FILE="$PID_DIR/factory-daemon.pid"
LOCK_DIR="$PID_DIR/factory-daemon.lock"

mkdir -p "$PID_DIR"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Daemon already running for factory '$FACTORY_ID' (pid $EXISTING_PID)" >&2
    exit 1
  fi

  rm -f "$PID_FILE"
  rmdir "$LOCK_DIR" 2>/dev/null || true
  mkdir "$LOCK_DIR"
fi

echo $$ > "$PID_FILE"

cleanup() {
  rm -f "$PID_FILE"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# @context:regression !critical TypeScript migration moved the shared daemon
# entrypoint off daemon.mjs. Keep the shell wrapper pointed at the checked-in
# source module that actually exists or managed factory host-start will
# immediately exit before logs/health can come up.
exec node "$SCRIPT_DIR/../packages/factory-ops/src/lib/daemon.ts" "$FACTORY_ID"
