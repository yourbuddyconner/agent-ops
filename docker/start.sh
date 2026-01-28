#!/bin/bash
set -e

export DISPLAY=:99
export HOME=/root

OPENCODE_PORT=4096
VSCODE_PORT=8080
VNC_PORT=6080
TTYD_PORT=7681
GATEWAY_PORT=9000

echo "[start.sh] Starting Agent-Ops sandbox"
echo "[start.sh] Session: ${SESSION_ID}"

# ─── VNC Stack ─────────────────────────────────────────────────────────

echo "[start.sh] Starting VNC stack (Xvfb + fluxbox + x11vnc + websockify)"
Xvfb :99 -screen 0 1920x1080x24 &
sleep 1
fluxbox &
x11vnc -display :99 -forever -shared -rfbport 5900 -nopw -quiet &
websockify --web /usr/share/novnc ${VNC_PORT} localhost:5900 &
echo "[start.sh] VNC accessible on port ${VNC_PORT}"

# Start Chromium in background (available via VNC)
chromium --no-sandbox --disable-gpu --window-size=1920,1080 --display=:99 &

# ─── code-server (VS Code) ────────────────────────────────────────────

echo "[start.sh] Starting code-server on port ${VSCODE_PORT}"
code-server \
  --bind-addr "127.0.0.1:${VSCODE_PORT}" \
  --auth none \
  --disable-telemetry \
  --disable-update-check \
  /workspace &

# ─── TTYD (web terminal) ──────────────────────────────────────────────

echo "[start.sh] Starting TTYD on port ${TTYD_PORT}"
ttyd -p ${TTYD_PORT} -i 127.0.0.1 -W bash &

# ─── OpenCode Server ──────────────────────────────────────────────────

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

# ─── Runner Process (main) ────────────────────────────────────────────

echo "[start.sh] Starting Runner process"
cd /runner
exec bun run src/bin.ts \
  --opencode-url "http://localhost:${OPENCODE_PORT}" \
  --do-url "${DO_WS_URL}" \
  --runner-token "${RUNNER_TOKEN}" \
  --session-id "${SESSION_ID}" \
  --gateway-port "${GATEWAY_PORT}"
