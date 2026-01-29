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

  async handlePrompt(messageId: string, content: string): Promise<void> {
    console.log(`[PromptHandler] Handling prompt ${messageId}: "${content.slice(0, 80)}"`);
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
      this.lastChunkTime = 0;
      this.toolStates.clear();

      // Notify client that agent is thinking
      this.agentClient.sendAgentStatus("thinking");

      // Send message async (fire-and-forget)
      await this.sendPromptAsync(this.sessionId, content);
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

    try {
      // OpenCode uses permission.respond for answering permission requests
      const res = await fetch(`${this.opencodeUrl}/session/${this.sessionId}/permission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: questionId, allow: Boolean(answer) }),
      });
      console.log(`[PromptHandler] Permission response: ${res.status}`);
    } catch (err) {
      console.error("[PromptHandler] Error forwarding answer:", err);
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

  private async sendPromptAsync(sessionId: string, content: string): Promise<void> {
    const url = `${this.opencodeUrl}/session/${sessionId}/prompt_async`;
    console.log(`[PromptHandler] POST ${url}`);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: content }],
      }),
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

      case "permission.updated": {
        // Permission request created or updated
        if (this.activeMessageId) {
          const id = String(props.id ?? "");
          const questionText = String(
            (props as Record<string, unknown>).message ??
            (props as Record<string, unknown>).description ??
            id ??
            "Permission requested"
          );
          if (id) {
            console.log(`[PromptHandler] Permission request: ${id}`);
            this.agentClient.sendQuestion(id, questionText);
          }
        }
        break;
      }

      case "server.connected":
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
    this.lastChunkTime = Date.now();
    this.resetResponseTimeout();

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

    // Only send a result message if there's text content (tool-only responses don't need one)
    if (content) {
      console.log(`[PromptHandler] Sending result for ${messageId} (${content.length} chars): "${content.slice(0, 100)}..."`);
      this.agentClient.sendResult(messageId, content);
    } else {
      console.log(`[PromptHandler] No text content for ${messageId}, skipping result (tools-only response)`);
    }

    console.log(`[PromptHandler] Sending complete`);
    this.agentClient.sendComplete();

    // Notify client that agent is idle
    this.agentClient.sendAgentStatus("idle");

    this.streamedContent = "";
    this.hasActivity = false;
    this.activeMessageId = null;
    this.lastChunkTime = 0;
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
