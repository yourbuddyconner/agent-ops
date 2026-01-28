/**
 * AgentClient — WebSocket connection from Runner to SessionAgent DO.
 *
 * Handles:
 * - Persistent WebSocket connection with auto-reconnect + exponential backoff
 * - Message buffering while disconnected
 * - Typed outbound/inbound message protocol
 */

import type { DOToRunnerMessage, RunnerToDOMessage } from "./types.js";

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

export class AgentClient {
  private ws: WebSocket | null = null;
  private buffer: string[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closing = false;

  private promptHandler: ((messageId: string, content: string) => void) | null = null;
  private answerHandler: ((questionId: string, answer: string | boolean) => void) | null = null;
  private stopHandler: (() => void) | null = null;

  constructor(
    private doUrl: string,
    private runnerToken: string,
  ) {}

  // ─── Lifecycle ───────────────────────────────────────────────────────

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.doUrl}?role=runner&token=${encodeURIComponent(this.runnerToken)}`;
      console.log(`[AgentClient] Connecting to DO: ${this.doUrl}`);

      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      this.ws.addEventListener("open", () => {
        console.log("[AgentClient] Connected to SessionAgent DO");
        this.reconnectAttempts = 0;
        this.flushBuffer();
        resolve();
      });

      this.ws.addEventListener("message", (event) => {
        this.handleMessage(event.data as string);
      });

      this.ws.addEventListener("close", (event) => {
        console.log(`[AgentClient] Connection closed: ${event.code} ${event.reason}`);
        this.ws = null;
        if (!this.closing) {
          this.scheduleReconnect();
        }
      });

      this.ws.addEventListener("error", (event) => {
        console.error("[AgentClient] WebSocket error:", event);
        // Close event will follow and trigger reconnect
      });
    });
  }

  disconnect(): void {
    this.closing = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "Runner shutting down");
      this.ws = null;
    }
  }

  // ─── Outbound (Runner → DO) ─────────────────────────────────────────

  sendStreamChunk(messageId: string, content: string): void {
    this.send({ type: "stream", messageId, content });
  }

  sendResult(messageId: string, content: string): void {
    this.send({ type: "result", messageId, content });
  }

  sendQuestion(questionId: string, text: string, options?: string[]): void {
    this.send({ type: "question", questionId, text, options });
  }

  sendToolCall(toolName: string, args: unknown, result: unknown): void {
    this.send({ type: "tool", toolName, args, result });
  }

  sendScreenshot(data: string, description: string): void {
    this.send({ type: "screenshot", data, description });
  }

  sendError(messageId: string, error: string): void {
    this.send({ type: "error", messageId, error });
  }

  sendComplete(): void {
    this.send({ type: "complete" });
  }

  // ─── Inbound Handlers (DO → Runner) ─────────────────────────────────

  onPrompt(handler: (messageId: string, content: string) => void): void {
    this.promptHandler = handler;
  }

  onAnswer(handler: (questionId: string, answer: string | boolean) => void): void {
    this.answerHandler = handler;
  }

  onStop(handler: () => void): void {
    this.stopHandler = handler;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private send(message: RunnerToDOMessage): void {
    const payload = JSON.stringify(message);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      // Buffer while disconnected
      this.buffer.push(payload);
    }
  }

  private flushBuffer(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    while (this.buffer.length > 0) {
      const msg = this.buffer.shift()!;
      this.ws.send(msg);
    }
  }

  private handleMessage(raw: string): void {
    let msg: DOToRunnerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error("[AgentClient] Invalid JSON from DO:", raw);
      return;
    }

    switch (msg.type) {
      case "prompt":
        this.promptHandler?.(msg.messageId, msg.content);
        break;
      case "answer":
        this.answerHandler?.(msg.questionId, msg.answer);
        break;
      case "stop":
        this.stopHandler?.();
        break;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts,
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts++;
    console.log(`[AgentClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        console.error("[AgentClient] Reconnect failed:", err);
        // Will retry on close event
      }
    }, delay);
  }
}
