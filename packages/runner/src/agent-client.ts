/**
 * AgentClient — WebSocket connection from Runner to SessionAgent DO.
 *
 * Handles:
 * - Persistent WebSocket connection with auto-reconnect + exponential backoff
 * - Message buffering while disconnected
 * - Typed outbound/inbound message protocol
 */

import type { AgentStatus, AvailableModels, DiffFile, DOToRunnerMessage, ReviewResultData, RunnerToDOMessage, ToolCallStatus } from "./types.js";

export interface PromptAuthor {
  gitName?: string;
  gitEmail?: string;
  authorName?: string;
  authorEmail?: string;
}

const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;
const PING_INTERVAL_MS = 30_000;
const SPAWN_CHILD_TIMEOUT_MS = 60_000;
const TERMINATE_CHILD_TIMEOUT_MS = 30_000;
const MESSAGE_OP_TIMEOUT_MS = 15_000;
const PR_OP_TIMEOUT_MS = 30_000;

export class AgentClient {
  private ws: WebSocket | null = null;
  private buffer: string[] = [];
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closing = false;

  private promptHandler: ((messageId: string, content: string, model?: string, author?: PromptAuthor, modelPreferences?: string[]) => void | Promise<void>) | null = null;
  private answerHandler: ((questionId: string, answer: string | boolean) => void | Promise<void>) | null = null;
  private stopHandler: (() => void) | null = null;
  private abortHandler: (() => void | Promise<void>) | null = null;
  private revertHandler: ((messageId: string) => void | Promise<void>) | null = null;
  private diffHandler: ((requestId: string) => void | Promise<void>) | null = null;
  private reviewHandler: ((requestId: string) => void | Promise<void>) | null = null;
  private tunnelDeleteHandler: ((name: string, actor?: { id?: string; name?: string; email?: string }) => void | Promise<void>) | null = null;

  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

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
        this.startPing();
        resolve();
      });

      this.ws.addEventListener("message", (event) => {
        this.handleMessage(event.data as string);
      });

      this.ws.addEventListener("close", (event) => {
        console.log(`[AgentClient] Connection closed: ${event.code} ${event.reason}`);
        this.stopPing();
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
    this.stopPing();
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

  sendToolCall(callID: string, toolName: string, status: ToolCallStatus, args: unknown, result: unknown): void {
    this.send({ type: "tool", callID, toolName, status, args, result });
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

  sendAgentStatus(status: AgentStatus, detail?: string): void {
    this.send({ type: "agentStatus", status, detail });
  }

  requestCreatePullRequest(params: { branch: string; title: string; body?: string; base?: string }): Promise<{ number: number; url: string; title: string; state: string }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, PR_OP_TIMEOUT_MS, () => {
      this.send({ type: "create-pr", requestId, ...params });
    });
  }

  requestUpdatePullRequest(params: { prNumber: number; title?: string; body?: string; state?: string; labels?: string[] }): Promise<{ number: number; url: string; title: string; state: string }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, PR_OP_TIMEOUT_MS, () => {
      this.send({ type: "update-pr", requestId, ...params });
    });
  }

  sendGitState(params: { branch?: string; baseBranch?: string; commitCount?: number }): void {
    this.send({ type: "git-state", ...params });
  }

  sendModels(models: AvailableModels): void {
    this.send({ type: "models", models });
  }

  sendModelSwitched(messageId: string, fromModel: string, toModel: string, reason: string): void {
    this.send({ type: "model-switched", messageId, fromModel, toModel, reason });
  }

  sendTunnels(tunnels: Array<{ name: string; port: number; protocol?: string; path: string }>): void {
    this.send({ type: "tunnels", tunnels });
  }

  sendAborted(): void {
    this.send({ type: "aborted" });
  }

  sendReverted(messageIds: string[]): void {
    this.send({ type: "reverted", messageIds });
  }

  sendDiff(requestId: string, files: DiffFile[]): void {
    this.send({ type: "diff", requestId, data: { files } });
  }

  sendFilesChanged(files: Array<{ path: string; status: string; additions?: number; deletions?: number }>): void {
    this.send({ type: "files-changed", files });
  }

  sendReviewResult(requestId: string, data?: ReviewResultData, diffFiles?: DiffFile[], error?: string): void {
    this.send({ type: "review-result", requestId, data, diffFiles, error });
  }

  sendChildSession(childSessionId: string, title?: string): void {
    this.send({ type: "child-session", childSessionId, title } as any);
  }

  // ─── Request/Response (Runner → DO → Runner) ─────────────────────────

  requestSpawnChild(params: {
    task: string;
    workspace: string;
    repoUrl?: string;
    branch?: string;
    ref?: string;
    title?: string;
    sourceType?: string;
    sourcePrNumber?: number;
    sourceIssueNumber?: number;
    sourceRepoFullName?: string;
    model?: string;
  }): Promise<{ childSessionId: string }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, SPAWN_CHILD_TIMEOUT_MS, () => {
      this.send({ type: "spawn-child", requestId, ...params });
    });
  }

  requestSendMessage(targetSessionId: string, content: string, interrupt: boolean = false): Promise<{ success: boolean }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "session-message", requestId, targetSessionId, content, interrupt });
    });
  }

  requestReadMessages(
    targetSessionId: string,
    limit?: number,
    after?: string,
  ): Promise<{ messages: Array<{ role: string; content: string; createdAt: string }> }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "session-messages", requestId, targetSessionId, limit, after });
    });
  }

  requestTerminateChild(childSessionId: string): Promise<{ success: boolean }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, TERMINATE_CHILD_TIMEOUT_MS, () => {
      this.send({ type: "terminate-child", requestId, childSessionId });
    });
  }

  requestMemoryRead(params: { category?: string; query?: string; limit?: number } = {}): Promise<{ memories: unknown[] }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "memory-read", requestId, ...params });
    });
  }

  requestMemoryWrite(content: string, category: string): Promise<{ memory: unknown; success: boolean }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "memory-write", requestId, content, category });
    });
  }

  requestMemoryDelete(memoryId: string): Promise<{ success: boolean }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "memory-delete", requestId, memoryId });
    });
  }

  requestListRepos(source?: string): Promise<{ repos: unknown[] }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "list-repos", requestId, source });
    });
  }

  requestListPullRequests(params: { owner?: string; repo?: string; state?: string; limit?: number }): Promise<{ pulls: unknown[] }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "list-pull-requests", requestId, ...params });
    });
  }

  requestInspectPullRequest(params: { prNumber: number; owner?: string; repo?: string; filesLimit?: number; commentsLimit?: number }): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "inspect-pull-request", requestId, ...params });
    });
  }

  requestListPersonas(): Promise<{ personas: unknown[] }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "list-personas", requestId });
    });
  }

  requestListChildSessions(): Promise<{ children: unknown[] }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "list-child-sessions", requestId });
    });
  }

  requestGetSessionStatus(targetSessionId: string): Promise<{ sessionStatus: unknown }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "get-session-status", requestId, targetSessionId });
    });
  }

  requestForwardMessages(targetSessionId: string, limit?: number, after?: string): Promise<{ count: number; sourceSessionId: string }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "forward-messages", requestId, targetSessionId, limit, after });
    });
  }

  requestReadRepoFile(params: { owner?: string; repo?: string; repoUrl?: string; path: string; ref?: string }): Promise<{ content: string; encoding?: string; truncated?: boolean; path?: string; repo?: string; ref?: string }> {
    const requestId = crypto.randomUUID();
    return this.createPendingRequest(requestId, MESSAGE_OP_TIMEOUT_MS, () => {
      this.send({ type: "read-repo-file", requestId, ...params });
    });
  }

  requestSelfTerminate(): void {
    this.send({ type: "self-terminate" });
    // Disconnect and exit — the DO will handle sandbox termination
    setTimeout(() => {
      this.disconnect();
      process.exit(0);
    }, 500);
  }

  private createPendingRequest<T>(requestId: string, timeoutMs: number, sendFn: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });
      sendFn();
    });
  }

  private resolvePendingRequest(requestId: string, value: any): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.resolve(value);
    }
  }

  private rejectPendingRequest(requestId: string, error: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);
      pending.reject(new Error(error));
    }
  }

  // ─── Inbound Handlers (DO → Runner) ─────────────────────────────────

  onPrompt(handler: (messageId: string, content: string, model?: string, author?: PromptAuthor, modelPreferences?: string[]) => void | Promise<void>): void {
    this.promptHandler = handler;
  }

  onAnswer(handler: (questionId: string, answer: string | boolean) => void | Promise<void>): void {
    this.answerHandler = handler;
  }

  onStop(handler: () => void): void {
    this.stopHandler = handler;
  }

  onAbort(handler: () => void | Promise<void>): void {
    this.abortHandler = handler;
  }

  onRevert(handler: (messageId: string) => void | Promise<void>): void {
    this.revertHandler = handler;
  }

  onDiff(handler: (requestId: string) => void | Promise<void>): void {
    this.diffHandler = handler;
  }

  onReview(handler: (requestId: string) => void | Promise<void>): void {
    this.reviewHandler = handler;
  }

  onTunnelDelete(handler: (name: string, actor?: { id?: string; name?: string; email?: string }) => void | Promise<void>): void {
    this.tunnelDeleteHandler = handler;
  }

  // ─── Keepalive ──────────────────────────────────────────────────────

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      this.send({ type: "ping" });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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

  private async handleMessage(raw: string): Promise<void> {
    let msg: DOToRunnerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error("[AgentClient] Invalid JSON from DO:", raw);
      return;
    }

    try {
      switch (msg.type) {
        case "prompt": {
          const author: PromptAuthor | undefined = (msg.gitName || msg.gitEmail || msg.authorName || msg.authorEmail)
            ? { gitName: msg.gitName, gitEmail: msg.gitEmail, authorName: msg.authorName, authorEmail: msg.authorEmail }
            : undefined;
          await this.promptHandler?.(msg.messageId, msg.content, msg.model, author, msg.modelPreferences);
          break;
        }
        case "answer":
          await this.answerHandler?.(msg.questionId, msg.answer);
          break;
        case "stop":
          this.stopHandler?.();
          break;
        case "abort":
          await this.abortHandler?.();
          break;
        case "revert":
          await this.revertHandler?.(msg.messageId);
          break;
        case "diff":
          await this.diffHandler?.(msg.requestId);
          break;
        case "review":
          await this.reviewHandler?.(msg.requestId);
          break;
        case "pong":
          // Keepalive response — no action needed
          break;

        case "spawn-child-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { childSessionId: msg.childSessionId });
          }
          break;

        case "session-message-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { success: true });
          }
          break;

        case "session-messages-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { messages: msg.messages ?? [] });
          }
          break;

        case "create-pr-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { number: msg.number, url: msg.url, title: msg.title, state: msg.state });
          }
          break;

        case "update-pr-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { number: msg.number, url: msg.url, title: msg.title, state: msg.state });
          }
          break;

        case "list-pull-requests-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { pulls: msg.pulls ?? [] });
          }
          break;

        case "inspect-pull-request-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, msg.data ?? null);
          }
          break;

        case "terminate-child-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { success: true });
          }
          break;

        case "memory-read-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { memories: msg.memories ?? [] });
          }
          break;

        case "memory-write-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { memory: msg.memory, success: true });
          }
          break;

        case "memory-delete-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { success: msg.success ?? true });
          }
          break;

        case "list-repos-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { repos: msg.repos ?? [] });
          }
          break;

        case "list-personas-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { personas: msg.personas ?? [] });
          }
          break;

        case "get-session-status-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { sessionStatus: msg.sessionStatus });
          }
          break;

        case "list-child-sessions-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { children: msg.children ?? [] });
          }
          break;

        case "forward-messages-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, { count: msg.count, sourceSessionId: msg.sourceSessionId });
          }
          break;
        case "read-repo-file-result":
          if (msg.error) {
            this.rejectPendingRequest(msg.requestId, msg.error);
          } else {
            this.resolvePendingRequest(msg.requestId, {
              content: msg.content ?? "",
              encoding: msg.encoding,
              truncated: msg.truncated,
              path: msg.path,
              repo: msg.repo,
              ref: msg.ref,
            });
          }
          break;
        case "tunnel-delete":
          await this.tunnelDeleteHandler?.(msg.name, {
            id: msg.actorId,
            name: msg.actorName,
            email: msg.actorEmail,
          });
          break;
      }
    } catch (err) {
      console.error(`[AgentClient] Error handling ${msg.type} message:`, err);
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
