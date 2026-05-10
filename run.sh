#!/usr/bin/env bash
# Start Media Manager in dev mode (backend + Electron)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

cleanup() {
    echo ""
    echo "Shutting down..."
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starting backend..."
uv run python backend_main.py &
BACKEND_PID=$!

# Wait for the backend to be ready
echo -n "    Waiting for backend"
for i in $(seq 1 20); do
    if curl -sf http://127.0.0.1:8765/api/config >/dev/null 2>&1; then
        echo " ready"
        break
    fi
    echo -n "."
    sleep 0.5
done

echo "==> Starting Electron..."
cd "$SCRIPT_DIR/frontend"
./node_modules/.bin/electron .

# Electron exiting triggers cleanup via trap
