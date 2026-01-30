#!/usr/bin/env bun
/**
 * Runner CLI — entrypoint for the sandbox runner process.
 *
 * Usage:
 *   bun run src/bin.ts \
 *     --opencode-url http://localhost:4096 \
 *     --do-url wss://worker.example.com/ws \
 *     --runner-token <token> \
 *     --session-id <id>
 */

import { parseArgs } from "util";
import { AgentClient } from "./agent-client.js";
import { PromptHandler } from "./prompt.js";
import { startGateway } from "./gateway.js";

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    "opencode-url": { type: "string" },
    "do-url": { type: "string" },
    "runner-token": { type: "string" },
    "session-id": { type: "string" },
    "gateway-port": { type: "string", default: "9000" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`
Agent-Ops Runner

Bridges the local OpenCode server and the SessionAgent Durable Object.

Options:
  --opencode-url   URL of the local OpenCode server (e.g. http://localhost:4096)
  --do-url         WebSocket URL of the SessionAgent DO
  --runner-token   Authentication token for the DO WebSocket
  --session-id     Session identifier
  --gateway-port   Auth gateway port (default: 9000)
  -h, --help       Show this help message
`);
  process.exit(0);
}

const opencodeUrl = values["opencode-url"];
const doUrl = values["do-url"];
const runnerToken = values["runner-token"];
const sessionId = values["session-id"];
const gatewayPort = parseInt(values["gateway-port"] || "9000", 10);

if (!opencodeUrl || !doUrl || !runnerToken || !sessionId) {
  console.error("Error: --opencode-url, --do-url, --runner-token, and --session-id are required");
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[Runner] Starting for session ${sessionId}`);
  console.log(`[Runner] OpenCode URL: ${opencodeUrl}`);
  console.log(`[Runner] DO URL: ${doUrl}`);

  // Connect to SessionAgent DO
  const agentClient = new AgentClient(doUrl!, runnerToken!);

  // Start auth gateway with image callback
  startGateway(gatewayPort, (data, description) => {
    agentClient.sendScreenshot(data, description);
  });
  const promptHandler = new PromptHandler(opencodeUrl!, agentClient);

  // Register handlers
  agentClient.onPrompt(async (messageId, content, model) => {
    console.log(`[Runner] Received prompt: ${messageId}${model ? ` (model: ${model})` : ''}`);
    await promptHandler.handlePrompt(messageId, content, model);
  });

  agentClient.onAnswer(async (questionId, answer) => {
    console.log(`[Runner] Received answer for question: ${questionId}`);
    await promptHandler.handleAnswer(questionId, answer);
  });

  agentClient.onStop(() => {
    console.log("[Runner] Received stop signal, shutting down");
    agentClient.disconnect();
    process.exit(0);
  });

  agentClient.onAbort(async () => {
    console.log("[Runner] Received abort signal");
    await promptHandler.handleAbort();
  });

  agentClient.onRevert(async (messageId) => {
    console.log(`[Runner] Received revert for message: ${messageId}`);
    await promptHandler.handleRevert(messageId);
  });

  agentClient.onDiff(async (requestId) => {
    console.log(`[Runner] Received diff request: ${requestId}`);
    await promptHandler.handleDiff(requestId);
  });

  // Brief delay before first connection — the sandbox may boot before the Worker
  // finishes calling /start on the DO to store our runner token (race condition).
  console.log("[Runner] Waiting 3s for DO initialization...");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Connect (will auto-reconnect on failure)
  await agentClient.connect();
  console.log("[Runner] Ready and waiting for prompts");

  // Discover available models from OpenCode and send to DO
  const models = await promptHandler.fetchAvailableModels();
  if (models.length > 0) {
    agentClient.sendModels(models);
    console.log(`[Runner] Sent ${models.length} provider(s) to DO`);
  }
}

main().catch((err) => {
  console.error("[Runner] Fatal error:", err);
  process.exit(1);
});
