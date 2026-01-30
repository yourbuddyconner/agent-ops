/**
 * PromptHandler — bridges OpenCode server and AgentClient.
 *
 * Uses the OpenCode HTTP API:
 * - POST /session         — create session
 * - POST /session/:id/prompt_async — send message (fire-and-forget, 204)
 * - GET  /event           — SSE stream for all events
 *
 * OpenCode SSE event types (from SDK types.gen.ts):
 * - message.part.updated  — { part: Part, delta?: string }
 *     Part.type: "text" | "tool" | "step-start" | "step-finish" | "reasoning" | ...
 *     For "tool" parts: { tool: string, state: { status, input, output } }
 * - message.updated       — { info: Message } where Message has role, etc.
 * - session.status         — { sessionID, status: { type: "idle"|"busy"|"retry" } }
 * - session.idle           — session became idle
 * - permission.updated     — permission request created/updated
 */

import { AgentClient } from "./agent-client.js";
import type { AvailableModels, DiffFile } from "./types.js";

// OpenCode ToolState status values
type ToolStatus = "pending" | "running" | "completed" | "error";

interface ToolState {
  status: ToolStatus;
  input?: unknown;
  output?: string;
  title?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  time?: { start?: number; end?: number };
}

interface ToolPart {
  type: "tool";
  id: string;
  sessionID?: string;
  messageID?: string;
  callID?: string;
  tool: string;       // tool name
  state: ToolState;
}

interface TextPart {
  type: "text";
  text?: string;
  [key: string]: unknown;
}

type Part = ToolPart | TextPart | { type: string; [key: string]: unknown };

// SessionStatus is an object: { type: "idle" } | { type: "busy" } | { type: "retry", ... }
interface SessionStatus {
  type: "idle" | "busy" | "retry";
  [key: string]: unknown;
}

type OpenCodeEvent = {
  type: string;
  properties?: Record<string, unknown>;
};

// Emergency fallback timeout — only fires if no idle/completion event arrives
const EMERGENCY_TIMEOUT_MS = 60_000;

export class PromptHandler {
  private opencodeUrl: string;
  private agentClient: AgentClient;
  private sessionId: string | null = null;
  private eventStreamActive = false;

  // Track current prompt so we can route events back to the DO
  private activeMessageId: string | null = null;
  private streamedContent = "";
  private hasActivity = false; // true if any text or tool events were received
  private lastChunkTime = 0;
  private responseTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Track tool states to detect completion (pending/running → completed)
  private toolStates = new Map<string, ToolStatus>();
  private lastError: string | null = null; // Track session errors
  private hadToolSinceLastText = false; // Track if tools ran since last text chunk

  // Message ID mapping: DO message IDs ↔ OpenCode message IDs
  private doToOcMessageId = new Map<string, string>();
  private ocToDOMessageId = new Map<string, string>();

  constructor(opencodeUrl: string, agentClient: AgentClient) {
    this.opencodeUrl = opencodeUrl;
    this.agentClient = agentClient;
  }

  /**
   * Start the global SSE event subscription. Call once at startup.
   */
  async startEventStream(): Promise<void> {
    if (this.eventStreamActive) return;
    this.eventStreamActive = true;

    console.log("[PromptHandler] Subscribing to OpenCode event stream");
    this.consumeEventStream().catch((err) => {
      console.error("[PromptHandler] Event stream failed:", err);
      this.eventStreamActive = false;
      // Retry after delay
      setTimeout(() => this.startEventStream(), 3000);
    });
  }

  async handlePrompt(messageId: string, content: string, model?: string): Promise<void> {
    console.log(`[PromptHandler] Handling prompt ${messageId}: "${content.slice(0, 80)}"${model ? ` (model: ${model})` : ''}`);
    try {
      // If there's a pending response from a previous prompt, finalize it first
      if (this.activeMessageId && this.hasActivity) {
        console.log(`[PromptHandler] Finalizing previous response before new prompt`);
        this.finalizeResponse();
      }

      // Clear any pending timeout from previous prompt
      this.clearResponseTimeout();

      // Create OpenCode session if needed
      if (!this.sessionId) {
        this.sessionId = await this.createSession();
        // Start event stream after session exists
        await this.startEventStream();
      }

      this.activeMessageId = messageId;
      this.streamedContent = "";
      this.hasActivity = false;
      this.hadToolSinceLastText = false;
      this.lastChunkTime = 0;
      this.lastError = null;
      this.toolStates.clear();

      // Notify client that agent is thinking
      this.agentClient.sendAgentStatus("thinking");

      // Send message async (fire-and-forget)
      await this.sendPromptAsync(this.sessionId, content, model);
      console.log(`[PromptHandler] Prompt ${messageId} sent to OpenCode`);

      // Response will arrive via SSE events — don't block here
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[PromptHandler] Error processing prompt:", errorMsg);
      this.agentClient.sendError(messageId, errorMsg);
      this.agentClient.sendComplete();
    }
  }

  async handleAnswer(questionId: string, answer: string | boolean): Promise<void> {
    if (!this.sessionId) return;
    const response = answer === false ? "reject" : "always";
    await this.respondToPermission(questionId, response);
  }

  private async approvePermission(permissionId: string): Promise<void> {
    await this.respondToPermission(permissionId, "always");
  }

  private async respondToPermission(permissionId: string, response: "once" | "always" | "reject"): Promise<void> {
    if (!this.sessionId) return;

    try {
      const url = `${this.opencodeUrl}/session/${this.sessionId}/permissions/${permissionId}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response }),
      });
      console.log(`[PromptHandler] Permission ${permissionId} → ${response}: ${res.status}`);
    } catch (err) {
      console.error("[PromptHandler] Error responding to permission:", err);
    }
  }

  async handleAbort(): Promise<void> {
    if (!this.sessionId) return;

    console.log("[PromptHandler] Aborting current generation");

    // Clear prompt state BEFORE the fetch so the SSE handler stops
    // forwarding events immediately (handlePartUpdated checks activeMessageId)
    this.clearResponseTimeout();
    this.activeMessageId = null;
    this.streamedContent = "";
    this.hasActivity = false;
    this.hadToolSinceLastText = false;
    this.lastChunkTime = 0;
    this.lastError = null;
    this.toolStates.clear();

    // Tell DO first so clients get immediate feedback
    this.agentClient.sendAborted();
    this.agentClient.sendAgentStatus("idle");

    // Then tell OpenCode to stop generating (may be slow)
    try {
      const res = await fetch(`${this.opencodeUrl}/session/${this.sessionId}/abort`, {
        method: "POST",
      });
      console.log(`[PromptHandler] Abort response: ${res.status}`);
    } catch (err) {
      console.error("[PromptHandler] Error calling abort:", err);
    }
  }

  async handleRevert(doMessageId: string): Promise<void> {
    if (!this.sessionId) return;

    console.log(`[PromptHandler] Reverting from DO message ${doMessageId}`);
    const ocMessageId = this.doToOcMessageId.get(doMessageId);
    if (ocMessageId) {
      try {
        const res = await fetch(`${this.opencodeUrl}/session/${this.sessionId}/revert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageID: ocMessageId }),
        });
        console.log(`[PromptHandler] Revert response: ${res.status}`);
      } catch (err) {
        console.error("[PromptHandler] Error calling revert:", err);
      }

      // Clean up mappings for the reverted message
      this.doToOcMessageId.delete(doMessageId);
      this.ocToDOMessageId.delete(ocMessageId);
    } else {
      console.warn(`[PromptHandler] No OpenCode message ID found for DO message ${doMessageId}`);
    }

    this.agentClient.sendReverted([doMessageId]);
  }

  async handleDiff(requestId: string): Promise<void> {
    if (!this.sessionId) {
      this.agentClient.sendDiff(requestId, []);
      return;
    }

    console.log(`[PromptHandler] Fetching diff for request ${requestId}`);
    try {
      const res = await fetch(`${this.opencodeUrl}/session/${this.sessionId}/diff`);
      if (!res.ok) {
        console.warn(`[PromptHandler] Diff response: ${res.status}`);
        this.agentClient.sendDiff(requestId, []);
        return;
      }

      const data = await res.json() as { files?: DiffFile[] } | DiffFile[];
      const files = Array.isArray(data) ? data : (data.files ?? []);
      console.log(`[PromptHandler] Diff: ${files.length} files`);
      this.agentClient.sendDiff(requestId, files);
    } catch (err) {
      console.error("[PromptHandler] Error fetching diff:", err);
      this.agentClient.sendDiff(requestId, []);
    }
  }

  // ─── OpenCode HTTP API ───────────────────────────────────────────────

  private async createSession(): Promise<string> {
    const res = await fetch(`${this.opencodeUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to create OpenCode session: ${res.status} ${body}`);
    }

    const data = (await res.json()) as { id: string };
    console.log(`[PromptHandler] Created OpenCode session: ${data.id}`);
    return data.id;
  }

  async fetchAvailableModels(): Promise<AvailableModels> {
    try {
      const res = await fetch(`${this.opencodeUrl}/provider`);
      if (!res.ok) {
        console.warn(`[PromptHandler] Failed to fetch providers: ${res.status}`);
        return [];
      }

      // Response shape: { all: Provider[], default: {...}, connected: string[] }
      // Provider: { id, name, models: { [key]: { id, name, ... } }, ... }
      const data = await res.json() as {
        all: Array<{
          id: string;
          name: string;
          models: Record<string, { id: string; name: string }>;
        }>;
        connected: string[];
      };

      if (!Array.isArray(data.all)) {
        console.warn("[PromptHandler] Unexpected /provider response shape:", JSON.stringify(data).slice(0, 200));
        return [];
      }

      // Only show providers listed in "connected" — providers must have their
      // API keys stored in ~/.local/share/opencode/auth.json (via start.sh)
      const connectedSet = new Set(data.connected || []);
      const result: AvailableModels = [];

      for (const provider of data.all) {
        if (!connectedSet.has(provider.id)) continue;
        if (!provider.models || typeof provider.models !== "object") continue;

        const models = Object.values(provider.models).map((m) => ({
          id: `${provider.id}/${m.id}`,
          name: m.name || m.id,
        }));
        if (models.length > 0) {
          result.push({ provider: provider.name || provider.id, models });
        }
      }

      console.log(`[PromptHandler] Discovered ${result.reduce((n, p) => n + p.models.length, 0)} models from ${result.length} providers`);
      return result;
    } catch (err) {
      console.warn("[PromptHandler] Error fetching available models:", err);
      return [];
    }
  }

  private async sendPromptAsync(sessionId: string, content: string, model?: string): Promise<void> {
    const url = `${this.opencodeUrl}/session/${sessionId}/prompt_async`;
    console.log(`[PromptHandler] POST ${url}${model ? ` (model: ${model})` : ''}`);

    const body: Record<string, unknown> = {
      parts: [{ type: "text", text: content }],
    };
    if (model) {
      // OpenCode expects model as { providerID, modelID }
      // Our model IDs come from the provider list as raw model IDs (e.g. "claude-3-5-sonnet-20241022")
      // with the provider known separately, but we store them with a provider prefix
      // like "providerID/modelID" or just "modelID" if provider is implicit.
      const slashIdx = model.indexOf("/");
      if (slashIdx !== -1) {
        body.model = { providerID: model.slice(0, slashIdx), modelID: model.slice(slashIdx + 1) };
      } else {
        // No provider prefix — need to find which provider owns this model
        // For now, pass just the modelID and let OpenCode figure it out
        body.model = { providerID: "", modelID: model };
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    console.log(`[PromptHandler] prompt_async response: ${res.status} ${res.statusText}`);

    if (!res.ok && res.status !== 204) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenCode prompt_async failed: ${res.status} — ${body}`);
    }
  }

  // ─── SSE Event Stream ─────────────────────────────────────────────────

  private async consumeEventStream(): Promise<void> {
    const url = `${this.opencodeUrl}/event`;
    console.log(`[PromptHandler] GET ${url} (SSE)`);

    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
    });

    console.log(`[PromptHandler] Event stream response: ${res.status} (type: ${res.headers.get("content-type")})`);

    if (!res.ok || !res.body) {
      throw new Error(`Failed to connect to event stream: ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(`[PromptHandler] Event stream ended after ${eventCount} events`);
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // SSE format: "data: {...}\n\n" — split on double newline
      const messages = buffer.split("\n\n");
      buffer = messages.pop() || "";

      for (const message of messages) {
        const lines = message.split("\n");
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            eventData += line.slice(6);
          } else if (line.startsWith("data:")) {
            eventData += line.slice(5);
          }
        }

        if (!eventData) continue;

        try {
          const event = JSON.parse(eventData) as OpenCodeEvent;
          eventCount++;

          if (eventCount <= 10 || eventCount % 50 === 0) {
            console.log(`[PromptHandler] SSE event #${eventCount}: type=${event.type}`);
          }

          this.handleEvent(event);
        } catch (err) {
          // Log first few parse failures for debugging
          if (eventCount < 10) {
            console.warn(`[PromptHandler] Failed to parse SSE: ${eventData.slice(0, 150)}`, err);
          }
        }
      }
    }

    // Stream ended — restart it
    this.eventStreamActive = false;
    setTimeout(() => this.startEventStream(), 1000);
  }

  private handleEvent(event: OpenCodeEvent): void {
    const props = event.properties;
    if (!props) return;

    // Filter to our session
    const eventSessionId = (props.sessionID ?? props.session_id) as string | undefined;
    if (eventSessionId && eventSessionId !== this.sessionId) return;

    switch (event.type) {
      case "message.part.updated": {
        this.handlePartUpdated(props);
        break;
      }

      case "message.updated": {
        this.handleMessageUpdated(props);
        break;
      }

      case "session.status": {
        this.handleSessionStatus(props);
        break;
      }

      case "session.idle": {
        // Dedicated idle event — finalize if we have activity
        console.log(`[PromptHandler] session.idle (activeMessageId: ${this.activeMessageId ? 'yes' : 'no'}, hasActivity: ${this.hasActivity})`);
        if (this.activeMessageId && this.hasActivity) {
          console.log(`[PromptHandler] Session idle, finalizing response`);
          this.finalizeResponse();
        }
        break;
      }

      case "permission.asked":
      case "permission.updated": {
        // Permission request — auto-approve since this is a headless agent
        const permId = String(props.id ?? "");
        const title = String(
          (props as Record<string, unknown>).title ??
          (props as Record<string, unknown>).message ??
          (props as Record<string, unknown>).description ??
          "Permission requested"
        );
        if (permId) {
          console.log(`[PromptHandler] Permission request: ${permId} — "${title}" (auto-approving)`);
          this.approvePermission(permId);
        }
        break;
      }

      case "session.error": {
        // OpenCode session error — extract error message
        // props.error may be an object (e.g. { message: "...", code: "..." }),
        // so we need to drill into it rather than just String()-ing it.
        const rawError = props.error ?? props.message ?? props.description;
        let errorMsg: string;
        if (rawError === undefined || rawError === null) {
          errorMsg = "Unknown agent error";
        } else if (typeof rawError === "string") {
          errorMsg = rawError;
        } else if (typeof rawError === "object") {
          // Try common error shape: { message: string } or { error: string }
          const obj = rawError as Record<string, unknown>;
          errorMsg = String(obj.message ?? obj.error ?? obj.description ?? JSON.stringify(rawError));
        } else {
          errorMsg = String(rawError);
        }
        console.error(`[PromptHandler] session.error: ${errorMsg}`);
        // Also log the raw structure for debugging
        console.error(`[PromptHandler] session.error raw:`, JSON.stringify(props));
        this.lastError = errorMsg;
        this.hasActivity = true;
        break;
      }

      case "server.connected":
      case "server.heartbeat":
      case "session.created":
      case "session.updated":
      case "session.deleted":
      case "session.compacted":
      case "session.diff":
      case "message.removed":
      case "message.part.removed":
      case "permission.replied":
      case "file.edited":
      case "file.watcher.updated":
      case "vcs.branch.updated":
      case "todo.updated":
      case "command.executed":
      case "lsp.updated":
      case "lsp.client.diagnostics":
        // Known events we don't need to handle
        break;

      default:
        console.log(`[PromptHandler] Unhandled event: ${event.type}`);
        break;
    }
  }

  private handlePartUpdated(props: Record<string, unknown>): void {
    if (!this.activeMessageId) return;

    // The part can be a tool part or a text part
    const part = props.part as Record<string, unknown> | undefined;
    if (!part) return;

    const partType = String(part.type ?? "");
    const delta = props.delta as string | undefined;

    if (partType === "text") {
      if (delta) {
        if (this.streamedContent === "") {
          this.agentClient.sendAgentStatus("streaming");
        }
        this.hasActivity = true;
        // Text resuming after tool calls — streamedContent was already committed
        // before the tool started, so just reset the flag and keep accumulating.
        if (this.hadToolSinceLastText) {
          this.hadToolSinceLastText = false;
        }
        this.streamedContent += delta;
        this.lastChunkTime = Date.now();
        this.agentClient.sendStreamChunk(this.activeMessageId, delta);
        this.resetResponseTimeout();
      }
    } else if (partType === "tool") {
      this.handleToolPart(part as unknown as ToolPart);
    } else if (partType === "step-start") {
      // Agent starting a new step (e.g., tool execution phase)
      this.hasActivity = true;
      this.lastChunkTime = Date.now();
      this.resetResponseTimeout();
    } else if (partType === "step-finish") {
      // Agent finished a step
      this.hasActivity = true;
      this.lastChunkTime = Date.now();
      this.resetResponseTimeout();
    } else if (partType === "reasoning") {
      // Reasoning/thinking — track activity but don't send to client
      this.hasActivity = true;
      this.lastChunkTime = Date.now();
      this.resetResponseTimeout();
    } else if (partType) {
      // Unknown part type — log and track
      console.log(`[PromptHandler] Unknown part type: "${partType}" keys=${Object.keys(part).join(",")}`);
      this.hasActivity = true;
      this.lastChunkTime = Date.now();
      this.resetResponseTimeout();
    }
  }

  private handleToolPart(part: ToolPart): void {
    const toolName = part.tool || "unknown";
    const state = part.state;
    if (!state) {
      console.log(`[PromptHandler] Tool part without state: ${toolName}`);
      return;
    }

    const callID = part.id || part.callID || toolName;
    const prevStatus = this.toolStates.get(callID);
    const currentStatus = state.status;

    // Only act on state transitions
    if (currentStatus === prevStatus) return;

    console.log(`[PromptHandler] Tool "${toolName}" [${callID}] ${prevStatus ?? "new"} → ${currentStatus}`);
    this.toolStates.set(callID, currentStatus);

    this.hasActivity = true;
    this.hadToolSinceLastText = true;
    this.lastChunkTime = Date.now();
    this.resetResponseTimeout();

    // When a NEW tool appears and we have accumulated text, commit the text
    // as a stored assistant message so it persists across page reloads.
    // The client merges consecutive assistant text messages back together.
    if (!prevStatus && this.streamedContent.trim() && this.activeMessageId) {
      console.log(`[PromptHandler] Committing text segment (${this.streamedContent.length} chars) before tool "${toolName}"`);
      this.agentClient.sendResult(this.activeMessageId, this.streamedContent);
      this.streamedContent = "";
    }

    // Send tool call on every state transition with callID + status
    if (currentStatus === "pending" || currentStatus === "running") {
      this.agentClient.sendAgentStatus("tool_calling", toolName);
      this.agentClient.sendToolCall(
        callID,
        toolName,
        currentStatus,
        state.input ?? null,
        null,
      );
    } else if (currentStatus === "completed") {
      const toolResult = state.output ?? null;
      console.log(`[PromptHandler] Tool "${toolName}" completed (output: ${typeof toolResult === "string" ? toolResult.length + " chars" : "null"})`);

      this.agentClient.sendToolCall(
        callID,
        toolName,
        "completed",
        state.input ?? null,
        toolResult,
      );

    } else if (currentStatus === "error") {
      console.log(`[PromptHandler] Tool "${toolName}" error: ${state.error}`);
      this.agentClient.sendToolCall(
        callID,
        toolName,
        "error",
        state.input ?? null,
        `Error: ${state.error}`,
      );
    }
  }

  private handleMessageUpdated(props: Record<string, unknown>): void {
    // OpenCode wraps the message in an "info" property: { info: { role, ... } }
    const info = (props.info ?? props) as Record<string, unknown>;
    const role = info.role as string | undefined;

    console.log(`[PromptHandler] message.updated: role=${role} (active: ${this.activeMessageId ? 'yes' : 'no'}, content: ${this.streamedContent.length} chars, activity: ${this.hasActivity})`);

    // Capture OpenCode message ID mapping for revert support
    const ocMessageId = info.id as string | undefined;
    if (ocMessageId && this.activeMessageId) {
      if (!this.doToOcMessageId.has(this.activeMessageId)) {
        this.doToOcMessageId.set(this.activeMessageId, ocMessageId);
        this.ocToDOMessageId.set(ocMessageId, this.activeMessageId);
        console.log(`[PromptHandler] Mapped DO message ${this.activeMessageId} → OC message ${ocMessageId}`);
      }
    }

    // Do NOT finalize on message.updated — even if time.completed is set.
    // OpenCode may create multiple assistant messages per prompt (e.g., one before
    // a tool call and one after). Finalizing on the first message's completion
    // drops all subsequent tool events (like browser_screenshot).
    // Instead, rely solely on session.idle / session.status: idle to finalize.
    if (role === "assistant" && this.activeMessageId) {
      this.hasActivity = true;
      this.lastChunkTime = Date.now();
      this.resetResponseTimeout();
    }
  }

  private handleSessionStatus(props: Record<string, unknown>): void {
    // SessionStatus is an object: { type: "idle" | "busy" | "retry" }
    const rawStatus = props.status;
    let statusType: string | undefined;

    if (typeof rawStatus === "string") {
      statusType = rawStatus;
    } else if (rawStatus && typeof rawStatus === "object") {
      statusType = (rawStatus as SessionStatus).type;
    }

    console.log(`[PromptHandler] session.status: "${statusType}" (active: ${this.activeMessageId ? 'yes' : 'no'}, content: ${this.streamedContent.length} chars, activity: ${this.hasActivity})`);

    if (statusType === "idle" && this.activeMessageId && this.hasActivity) {
      console.log(`[PromptHandler] Session idle, finalizing response`);
      this.finalizeResponse();
    }
  }

  private finalizeResponse(): void {
    if (!this.activeMessageId || !this.hasActivity) {
      console.log(`[PromptHandler] finalizeResponse: skipping (activeMessageId: ${this.activeMessageId ? 'yes' : 'no'}, hasActivity: ${this.hasActivity})`);
      return;
    }

    // Clear any pending timeout
    this.clearResponseTimeout();

    const messageId = this.activeMessageId;
    const content = this.streamedContent;

    // Send result, error, or nothing depending on what happened
    if (content) {
      console.log(`[PromptHandler] Sending result for ${messageId} (${content.length} chars): "${content.slice(0, 100)}..."`);
      this.agentClient.sendResult(messageId, content);
    } else if (this.lastError) {
      console.log(`[PromptHandler] Sending error for ${messageId}: ${this.lastError}`);
      this.agentClient.sendError(messageId, this.lastError);
    } else {
      console.log(`[PromptHandler] No text content for ${messageId}, skipping result (tools-only response)`);
    }

    console.log(`[PromptHandler] Sending complete`);
    this.agentClient.sendComplete();

    // Notify client that agent is idle
    this.agentClient.sendAgentStatus("idle");

    this.streamedContent = "";
    this.hasActivity = false;
    this.hadToolSinceLastText = false;
    this.activeMessageId = null;
    this.lastChunkTime = 0;
    this.lastError = null;
    this.toolStates.clear();
    console.log(`[PromptHandler] Response finalized`);
  }

  private resetResponseTimeout(): void {
    this.clearResponseTimeout();
    // Set a timeout to finalize the response if no completion event is received
    this.responseTimeoutId = setTimeout(() => {
      if (this.activeMessageId && this.hasActivity) {
        const timeSinceLastChunk = Date.now() - this.lastChunkTime;
        console.log(`[PromptHandler] Response timeout triggered (${timeSinceLastChunk}ms since last chunk)`);
        this.finalizeResponse();
      }
    }, EMERGENCY_TIMEOUT_MS);
  }

  private clearResponseTimeout(): void {
    if (this.responseTimeoutId) {
      clearTimeout(this.responseTimeoutId);
      this.responseTimeoutId = null;
    }
  }
}
