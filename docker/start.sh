#!/bin/bash
set -e

OPENCODE_PORT=4096
GATEWAY_PORT=9000

echo "[start.sh] Starting Agent-Ops sandbox"
echo "[start.sh] Session: ${SESSION_ID}"

# ─── Phase 1 services only ──────────────────────────────────────────────
# Phase 2 adds: code-server, VNC (Xvfb + x11vnc + websockify + fluxbox), TTYD

# ─── OpenCode Server ────────────────────────────────────────────────────

echo "[start.sh] Starting OpenCode server on port ${OPENCODE_PORT}"
cd /workspace
opencode serve --hostname 0.0.0.0 --port ${OPENCODE_PORT} &
OPENCODE_PID=$!

# Wait for OpenCode to be healthy
echo "[start.sh] Waiting for OpenCode health..."
MAX_RETRIES=60
RETRY=0
until curl -sf http://localhost:${OPENCODE_PORT}/health > /dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ $RETRY -ge $MAX_RETRIES ]; then
    echo "[start.sh] ERROR: OpenCode failed to start after ${MAX_RETRIES} retries"
    exit 1
  fi
  sleep 1
done
echo "[start.sh] OpenCode is healthy"

# ─── Runner Process (main) ─────────────────────────────────────────────

echo "[start.sh] Starting Runner process"
cd /runner
exec bun run src/bin.ts \
  --opencode-url "http://localhost:${OPENCODE_PORT}" \
  --do-url "${DO_WS_URL}" \
  --runner-token "${RUNNER_TOKEN}" \
  --session-id "${SESSION_ID}" \
  --gateway-port "${GATEWAY_PORT}"
