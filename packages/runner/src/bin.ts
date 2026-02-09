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

  // Start auth gateway with callbacks
  startGateway(gatewayPort, {
    onImage: (data, description) => {
      agentClient.sendScreenshot(data, description);
    },
    onSpawnChild: async (params) => {
      const result = await agentClient.requestSpawnChild(params);
      // Notify clients of the new child session for UI updates
      agentClient.sendChildSession(result.childSessionId, params.title || params.workspace);
      return result;
    },
    onTerminateChild: async (childSessionId) => {
      return await agentClient.requestTerminateChild(childSessionId);
    },
    onSelfTerminate: () => {
      agentClient.requestSelfTerminate();
    },
    onSendMessage: async (targetSessionId, content, interrupt) => {
      await agentClient.requestSendMessage(targetSessionId, content, interrupt);
    },
    onReadMessages: async (targetSessionId, limit, after) => {
      const result = await agentClient.requestReadMessages(targetSessionId, limit, after);
      return result.messages;
    },
    onCreatePullRequest: async (params) => {
      return await agentClient.requestCreatePullRequest(params);
    },
    onUpdatePullRequest: async (params) => {
      return await agentClient.requestUpdatePullRequest(params);
    },
    onListPullRequests: async (params) => {
      return await agentClient.requestListPullRequests(params);
    },
    onInspectPullRequest: async (params) => {
      return await agentClient.requestInspectPullRequest(params);
    },
    onReportGitState: (params) => {
      agentClient.sendGitState(params);
    },
    onMemoryRead: async (params) => {
      return await agentClient.requestMemoryRead(params);
    },
    onMemoryWrite: async (content, category) => {
      return await agentClient.requestMemoryWrite(content, category);
    },
    onMemoryDelete: async (memoryId) => {
      return await agentClient.requestMemoryDelete(memoryId);
    },
    onListRepos: async (source) => {
      return await agentClient.requestListRepos(source);
    },
    onListPersonas: async () => {
      return await agentClient.requestListPersonas();
    },
    onGetSessionStatus: async (targetSessionId) => {
      return await agentClient.requestGetSessionStatus(targetSessionId);
    },
    onListChildSessions: async () => {
      return await agentClient.requestListChildSessions();
    },
    onForwardMessages: async (targetSessionId, limit, after) => {
      return await agentClient.requestForwardMessages(targetSessionId, limit, after);
    },
    onReadRepoFile: async (params) => {
      return await agentClient.requestReadRepoFile(params);
    },
    onListWorkflows: async () => {
      return await agentClient.requestListWorkflows();
    },
    onSyncWorkflow: async (params) => {
      return await agentClient.requestSyncWorkflow(params);
    },
    onGetWorkflow: async (workflowId) => {
      return await agentClient.requestGetWorkflow(workflowId);
    },
    onUpdateWorkflow: async (workflowId, payload) => {
      return await agentClient.requestUpdateWorkflow(workflowId, payload);
    },
    onDeleteWorkflow: async (workflowId) => {
      return await agentClient.requestDeleteWorkflow(workflowId);
    },
    onRunWorkflow: async (params) => {
      return await agentClient.requestRunWorkflow(
        params.workflowId,
        params.variables,
        {
          repoUrl: params.repoUrl,
          branch: params.branch,
          ref: params.ref,
          sourceRepoFullName: params.sourceRepoFullName,
        },
      );
    },
    onListWorkflowExecutions: async (workflowId, limit) => {
      return await agentClient.requestListWorkflowExecutions(workflowId, limit);
    },
    onListTriggers: async (filters) => {
      return await agentClient.requestListTriggers(filters);
    },
    onSyncTrigger: async (params) => {
      return await agentClient.requestSyncTrigger(params);
    },
    onRunTrigger: async (triggerId, params) => {
      return await agentClient.requestRunTrigger(triggerId, params);
    },
    onDeleteTrigger: async (triggerId) => {
      return await agentClient.requestDeleteTrigger(triggerId);
    },
    onGetExecution: async (executionId) => {
      return await agentClient.requestGetExecution(executionId);
    },
    onGetExecutionSteps: async (executionId) => {
      return await agentClient.requestGetExecutionSteps(executionId);
    },
    onApproveExecution: async (executionId, params) => {
      return await agentClient.requestApproveExecution(executionId, params);
    },
    onCancelExecution: async (executionId, params) => {
      return await agentClient.requestCancelExecution(executionId, params);
    },
    onTunnelsUpdated: (tunnels) => {
      agentClient.sendTunnels(tunnels);
    },
    // Phase C: Mailbox + Task Board
    onMailboxSend: async (params) => {
      return await agentClient.requestMailboxSend(params);
    },
    onMailboxCheck: async (limit, after) => {
      return await agentClient.requestMailboxCheck(limit, after);
    },
    onTaskCreate: async (params) => {
      return await agentClient.requestTaskCreate(params);
    },
    onTaskList: async (params) => {
      return await agentClient.requestTaskList(params);
    },
    onTaskUpdate: async (taskId, updates) => {
      return await agentClient.requestTaskUpdate(taskId, updates);
    },
    onMyTasks: async (status) => {
      return await agentClient.requestMyTasks(status);
    },
    // Phase D: Channel Reply
    onChannelReply: async (channelType, channelId, message, imageBase64, imageMimeType) => {
      return await agentClient.requestChannelReply(channelType, channelId, message, imageBase64, imageMimeType);
    },
  });
  const promptHandler = new PromptHandler(opencodeUrl!, agentClient, sessionId!);

  // Register handlers
  agentClient.onPrompt(async (messageId, content, model, author, modelPreferences, attachments, channelType, channelId) => {
    console.log(`[Runner] Received prompt: ${messageId}${model ? ` (model: ${model})` : ''}${author?.authorName ? ` (by: ${author.authorName})` : ''}${modelPreferences?.length ? ` (prefs: ${modelPreferences.length} models)` : ''}${attachments?.length ? ` (attachments: ${attachments.length})` : ''}${channelType ? ` (channel: ${channelType})` : ''}`);
    await promptHandler.handlePrompt(messageId, content, model, author, modelPreferences, attachments, channelType, channelId);
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

  agentClient.onReview(async (requestId) => {
    console.log(`[Runner] Received review request: ${requestId}`);
    await promptHandler.handleReview(requestId);
  });

  agentClient.onTunnelDelete(async (name, actor) => {
    console.log(`[Runner] Received tunnel delete: ${name} (actor=${actor?.name || actor?.email || actor?.id || "unknown"})`);
    try {
      const resp = await fetch(`http://localhost:${gatewayPort}/api/tunnels/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!resp.ok) {
        const errText = await resp.text();
        console.error(`[Runner] Tunnel delete failed: ${errText}`);
      }
    } catch (err) {
      console.error("[Runner] Tunnel delete error:", err);
    }
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
