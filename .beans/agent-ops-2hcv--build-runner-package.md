---
# agent-ops-2hcv
title: Build Runner package
status: completed
type: task
priority: critical
tags:
    - runner
    - phase1
created_at: 2026-01-28T03:57:15Z
updated_at: 2026-01-28T04:29:54Z
parent: agent-ops-jcbs
---

Create packages/runner/ — Bun/TypeScript process that runs inside Modal sandboxes. Bridges OpenCode server and SessionAgent DO via WebSocket.

Implements:
- packages/runner/src/bin.ts: CLI entrypoint (--opencode-url, --do-url, --runner-token, --session-id)
- packages/runner/src/agent-client.ts: WebSocket to SessionAgent DO with reconnect + buffer
  Outbound: sendStreamChunk, sendResult, sendQuestion, sendToolCall, sendScreenshot, sendError, sendComplete
  Inbound: onPrompt, onAnswer, onStop handlers
- packages/runner/src/prompt.ts: PromptHandler using @opencode-ai/sdk
  Creates OpenCode session, sends messages, subscribes to event stream, maps events to AgentClient calls
- packages/runner/src/events.ts: OpenCode event stream consumer (message.delta, message.complete, session.question, tool.call, tool.result)
- packages/runner/src/gateway.ts: Auth gateway proxy on port 9000 (Phase 2, stub for now)
- packages/runner/src/types.ts
- packages/runner/package.json, tsconfig.json

Acceptance criteria:
- bun run src/bin.ts --help shows usage
- Connects to a DO WebSocket endpoint and authenticates with runner token
- Receives prompt via WebSocket, forwards to local OpenCode, streams response back
- Sends 'complete' signal when prompt finishes
- Reconnects automatically on WebSocket disconnect
- TypeScript compiles clean with bun build