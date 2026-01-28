---
# agent-ops-d4i5
title: Start auth gateway and Runner process in start.sh
status: todo
type: bug
priority: critical
tags:
    - sandbox
created_at: 2026-01-28T07:08:19Z
updated_at: 2026-01-28T07:08:19Z
parent: agent-ops-jcbs
---

docker/start.sh currently ends with 'exec sleep infinity' instead of launching the gateway and Runner. Two things must be added:

1. **Auth gateway** (port 9000): The gateway.ts implementation exists in packages/runner/src/gateway.ts and is complete with JWT validation, but start.sh never starts it. Without it, port 9000 has nothing listening and VS Code/VNC/TTYD iframes fail.

2. **Runner process** (main process): bin.ts exists in packages/runner/src/bin.ts and is complete, but start.sh never starts it. Without it, no WebSocket connection from sandbox to SessionAgent DO, so no prompts are processed.

Replace the sleep infinity block (lines 67-76) with:

  # Auth Gateway
  echo '[start.sh] Starting auth gateway on port ${GATEWAY_PORT}'
  cd /runner
  bun run gateway.js &

  # Runner (main process)
  echo '[start.sh] Starting Runner'
  exec bun run bin.js \
    --opencode-url "http://localhost:${OPENCODE_PORT}" \
    --do-url "${DO_WS_URL}" \
    --runner-token "${RUNNER_TOKEN}" \
    --session-id "${SESSION_ID}" \
    --gateway-port "${GATEWAY_PORT}"

**Done when:** A sandbox starts the gateway on port 9000 and the Runner as PID 1 (exec). Runner connects to DO via WebSocket.