/**
 * PromptHandler — bridges OpenCode SDK and AgentClient.
 *
 * Receives prompts from the DO via AgentClient, sends them to the local
 * OpenCode server, subscribes to the event stream, and forwards events
 * back to the DO.
 *
 * NOTE: The @opencode-ai/sdk package API is not finalized. This module
 * implements the expected interface and will need adjustment once the
 * SDK stabilizes. For Phase 1, we use HTTP calls to the OpenCode server.
 */

import { AgentClient } from "./agent-client.js";

export class PromptHandler {
  private opencodeUrl: string;
  private agentClient: AgentClient;
  private sessionId: string | null = null;

  constructor(opencodeUrl: string, agentClient: AgentClient) {
    this.opencodeUrl = opencodeUrl;
    this.agentClient = agentClient;
  }

  async handlePrompt(messageId: string, content: string): Promise<void> {
    try {
      // Create OpenCode session if needed
      if (!this.sessionId) {
        this.sessionId = await this.createSession();
      }

      // Send message to OpenCode and stream response
      await this.streamChat(this.sessionId, messageId, content);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[PromptHandler] Error processing prompt:", errorMsg);
      this.agentClient.sendError(messageId, errorMsg);
    } finally {
      this.agentClient.sendComplete();
    }
  }

  async handleAnswer(questionId: string, answer: string | boolean): Promise<void> {
    if (!this.sessionId) return;

    try {
      await fetch(`${this.opencodeUrl}/session/${this.sessionId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, answer: String(answer) }),
      });
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
      throw new Error(`Failed to create OpenCode session: ${res.status}`);
    }

    const data = (await res.json()) as { id: string };
    console.log(`[PromptHandler] Created OpenCode session: ${data.id}`);
    return data.id;
  }

  private async streamChat(sessionId: string, messageId: string, content: string): Promise<void> {
    const res = await fetch(`${this.opencodeUrl}/session/${sessionId}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({ message: content }),
    });

    if (!res.ok) {
      throw new Error(`OpenCode chat failed: ${res.status}`);
    }

    if (!res.body) {
      throw new Error("No response body from OpenCode");
    }

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as {
              type: string;
              content?: string;
              questionId?: string;
              text?: string;
              options?: string[];
              toolName?: string;
              args?: unknown;
              result?: unknown;
            };

            switch (event.type) {
              case "message.delta":
                if (event.content) {
                  fullContent += event.content;
                  this.agentClient.sendStreamChunk(messageId, event.content);
                }
                break;

              case "message.complete":
                this.agentClient.sendResult(messageId, fullContent);
                fullContent = "";
                break;

              case "session.question":
                if (event.questionId && event.text) {
                  this.agentClient.sendQuestion(event.questionId, event.text, event.options);
                }
                break;

              case "tool.call":
              case "tool.result":
                if (event.toolName) {
                  this.agentClient.sendToolCall(event.toolName, event.args, event.result);
                }
                break;
            }
          } catch {
            // Skip malformed JSON events
          }
        }
      }
    }

    // If we accumulated content but never got message.complete, send what we have
    if (fullContent) {
      this.agentClient.sendResult(messageId, fullContent);
    }
  }
}
