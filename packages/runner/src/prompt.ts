/**
 * PromptHandler — bridges OpenCode server and AgentClient.
 *
 * Uses the OpenCode HTTP API:
 * - POST /session         — create session
 * - POST /session/:id/prompt_async — send message (fire-and-forget, 204)
 * - GET  /event           — SSE stream for all events
 *
 * Events of interest:
 * - message.part.updated  — { part: Part, delta?: string } — streaming text
 * - message.updated       — message metadata updated (role, status)
 * - permission.request    — agent asking user a question
 */

import { AgentClient } from "./agent-client.js";

interface MessagePartUpdatedEvent {
  type: "message.part.updated";
  properties: {
    sessionID: string;
    messageID: string;
    part: {
      type: string;
      text?: string;
      [key: string]: unknown;
    };
    delta?: string;
  };
}

interface MessageUpdatedEvent {
  type: "message.updated";
  properties: {
    id: string;
    sessionID: string;
    role: string;
    [key: string]: unknown;
  };
}

interface PermissionRequestEvent {
  type: "permission.request";
  properties: {
    id: string;
    sessionID: string;
    [key: string]: unknown;
  };
}

interface SessionStatusEvent {
  type: "session.status";
  properties: {
    sessionID: string;
    status: string;
    [key: string]: unknown;
  };
}

type OpenCodeEvent =
  | MessagePartUpdatedEvent
  | MessageUpdatedEvent
  | PermissionRequestEvent
  | SessionStatusEvent
  | { type: string; properties?: Record<string, unknown> };

// Timeout for finalizing response if no completion event is received
const RESPONSE_TIMEOUT_MS = 5000;

export class PromptHandler {
  private opencodeUrl: string;
  private agentClient: AgentClient;
  private sessionId: string | null = null;
  private eventStreamActive = false;

  // Track current prompt so we can route events back to the DO
  private activeMessageId: string | null = null;
  private streamedContent = "";
  private lastChunkTime = 0;
  private responseTimeoutId: ReturnType<typeof setTimeout> | null = null;

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
      if (this.activeMessageId && this.streamedContent) {
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
      this.lastChunkTime = 0;

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

          if (eventCount <= 5 || eventCount % 100 === 0) {
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
    // Only process events for our session
    const props = event.properties;
    if (!props) return;

    const eventSessionId = (props as Record<string, unknown>).sessionID as string | undefined;
    if (eventSessionId && eventSessionId !== this.sessionId) return;

    switch (event.type) {
      case "message.part.updated": {
        const { part, delta } = (event as MessagePartUpdatedEvent).properties;
        if (!this.activeMessageId) break;

        if (part.type === "text" && delta) {
          this.streamedContent += delta;
          this.lastChunkTime = Date.now();
          this.agentClient.sendStreamChunk(this.activeMessageId, delta);
          // Reset timeout on each chunk
          this.resetResponseTimeout();
        }
        break;
      }

      case "message.updated": {
        const msgProps = (event as MessageUpdatedEvent).properties;
        console.log(`[PromptHandler] Message updated: role=${msgProps.role} (activeMessageId: ${this.activeMessageId ? 'yes' : 'no'}, streamedContent: ${this.streamedContent.length} chars)`);

        // When assistant message finishes, send the result
        // Note: This may fire before streaming is complete, so we also check session.status
        if (msgProps.role === "assistant" && this.activeMessageId && this.streamedContent) {
          console.log(`[PromptHandler] Assistant message complete, finalizing response`);
          this.finalizeResponse();
        }
        break;
      }

      case "session.status": {
        const statusProps = (event as SessionStatusEvent).properties;
        console.log(`[PromptHandler] Session status: "${statusProps.status}" (activeMessageId: ${this.activeMessageId ? 'yes' : 'no'}, streamedContent: ${this.streamedContent.length} chars)`);
        // When session becomes idle/ready/waiting after processing, finalize the response
        // OpenCode may use different status values depending on version
        const idleStatuses = ["idle", "ready", "waiting", "completed", "done"];
        if (idleStatuses.includes(statusProps.status) && this.activeMessageId && this.streamedContent) {
          console.log(`[PromptHandler] Session ${statusProps.status}, finalizing response`);
          this.finalizeResponse();
        }
        break;
      }

      case "permission.request": {
        const permProps = (event as PermissionRequestEvent).properties;
        if (this.activeMessageId) {
          const questionText = String(permProps.id || "Permission requested");
          this.agentClient.sendQuestion(permProps.id, questionText);
        }
        break;
      }
    }
  }

  private finalizeResponse(): void {
    if (!this.activeMessageId || !this.streamedContent) {
      console.log(`[PromptHandler] finalizeResponse: skipping (activeMessageId: ${this.activeMessageId ? 'yes' : 'no'}, streamedContent: ${this.streamedContent.length} chars)`);
      return;
    }

    // Clear any pending timeout
    this.clearResponseTimeout();

    const messageId = this.activeMessageId;
    const content = this.streamedContent;

    console.log(`[PromptHandler] Sending result for ${messageId} (${content.length} chars): "${content.slice(0, 100)}..."`);
    this.agentClient.sendResult(messageId, content);
    console.log(`[PromptHandler] Sending complete`);
    this.agentClient.sendComplete();

    this.streamedContent = "";
    this.activeMessageId = null;
    this.lastChunkTime = 0;
    console.log(`[PromptHandler] Response finalized`);
  }

  private resetResponseTimeout(): void {
    this.clearResponseTimeout();
    // Set a timeout to finalize the response if no completion event is received
    this.responseTimeoutId = setTimeout(() => {
      if (this.activeMessageId && this.streamedContent) {
        const timeSinceLastChunk = Date.now() - this.lastChunkTime;
        console.log(`[PromptHandler] Response timeout triggered (${timeSinceLastChunk}ms since last chunk)`);
        this.finalizeResponse();
      }
    }, RESPONSE_TIMEOUT_MS);
  }

  private clearResponseTimeout(): void {
    if (this.responseTimeoutId) {
      clearTimeout(this.responseTimeoutId);
      this.responseTimeoutId = null;
    }
  }
}
