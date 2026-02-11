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

import { createTwoFilesPatch } from "diff";
import { AgentClient, type PromptAuthor } from "./agent-client.js";
import type { AvailableModels, DiffFile, PromptAttachment, ReviewFileSummary, ReviewResultData } from "./types.js";
import { compileWorkflowDefinition, type NormalizedWorkflowStep } from "./workflow-compiler.js";
import {
  executeWorkflowResume,
  executeWorkflowRun,
  type WorkflowRunPayload,
  type WorkflowStepExecutionContext,
  type WorkflowStepExecutionResult,
} from "./workflow-engine.js";

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

interface OpenCodeErrorLike {
  name?: string;
  data?: Record<string, unknown>;
  message?: string;
  [key: string]: unknown;
}

interface OpenCodeMessageInfo {
  id?: string;
  role?: string;
  sessionID?: string;
  parts?: unknown[];
  content?: string;
  error?: OpenCodeErrorLike | string;
  [key: string]: unknown;
}

interface OpenCodeQuestionOption {
  label?: string;
  description?: string;
}

interface OpenCodeQuestionInfo {
  question?: string;
  header?: string;
  options?: OpenCodeQuestionOption[];
  multiple?: boolean;
  custom?: boolean;
}

type OpenCodeEvent =
  | {
      type: "message.part.updated";
      properties: {
        part: Part;
        delta?: string;
      } & Record<string, unknown>;
    }
  | {
      type: "message.updated";
      properties: {
        info: OpenCodeMessageInfo;
      } & Record<string, unknown>;
    }
  | {
      type: "session.status";
      properties: {
        sessionID?: string;
        status: SessionStatus;
      } & Record<string, unknown>;
    }
  | {
      type: "session.idle";
      properties: {
        sessionID?: string;
      } & Record<string, unknown>;
    }
  | {
      type: "session.error";
      properties: {
        sessionID?: string;
        error?: OpenCodeErrorLike | string;
      } & Record<string, unknown>;
    }
  | {
      type: string;
      properties?: Record<string, unknown>;
    };

interface AssistantMessageRecovery {
  text: string | null;
  error: string | null;
  modelLabel?: string;
  finish?: string;
  outputTokens?: number | null;
}

interface WorkflowExecutionDispatchPayload {
  kind: "run" | "resume";
  executionId: string;
  workflowHash?: string;
  resumeToken?: string;
  decision?: "approve" | "deny";
  payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function normalizeOpenCodeEvent(raw: unknown): OpenCodeEvent | null {
  if (!isRecord(raw)) return null;
  const maybePayload = isRecord(raw.payload) ? raw.payload : raw;
  const type = maybePayload.type;
  if (typeof type !== "string") return null;
  const properties = isRecord(maybePayload.properties) ? maybePayload.properties : {};
  return {
    type,
    properties,
  };
}

function openCodeErrorToMessage(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  if (!isRecord(raw)) return null;

  const data = isRecord(raw.data) ? raw.data : undefined;
  const namedMessage =
    (data && typeof data.message === "string" ? data.message : undefined) ??
    (typeof raw.message === "string" ? raw.message : undefined);
  if (namedMessage && namedMessage.trim()) return namedMessage.trim();

  const fallback = JSON.stringify(raw);
  return fallback && fallback !== "{}" ? fallback : null;
}

// Emergency fallback timeout — only fires if no idle/completion event arrives
const EMERGENCY_TIMEOUT_MS = 60_000;

// Review polling configuration
const REVIEW_POLL_INTERVAL_MS = 500;
const REVIEW_TIMEOUT_MS = 120_000;

const REVIEW_PROMPT = `You are a code reviewer. Analyze the following diff and produce a structured JSON review.

Return ONLY a fenced JSON block (\`\`\`json ... \`\`\`) with this exact structure:

{
  "overallSummary": "Brief summary of all changes",
  "files": [
    {
      "path": "file/path.ts",
      "summary": "What changed in this file",
      "reviewOrder": 1,
      "linesAdded": 10,
      "linesDeleted": 5,
      "findings": [
        {
          "id": "f1",
          "file": "file/path.ts",
          "lineStart": 10,
          "lineEnd": 15,
          "severity": "warning",
          "category": "logic",
          "title": "Short title",
          "description": "Detailed description of the issue",
          "suggestedFix": "Optional code or description of fix"
        }
      ]
    }
  ],
  "stats": { "critical": 0, "warning": 1, "suggestion": 0, "nitpick": 0 }
}

Severity levels:
- critical: Bugs, security issues, data loss risks
- warning: Logic errors, performance problems, missing error handling
- suggestion: Better approaches, readability improvements
- nitpick: Style, naming, minor preferences

Categories: logic, security, performance, error-handling, types, style, naming, documentation, testing, architecture

IMPORTANT: Do NOT create duplicate findings. If the same issue applies to a range of lines, create ONE finding with lineStart/lineEnd spanning the full range. Never create multiple findings with the same title for adjacent or nearby lines.

Review these changes:

`;

function parseReviewResponse(content: string): ReviewResultData | null {
  // Extract JSON from fenced code block
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[1].trim());

    // Validate structure
    if (!parsed.files || !Array.isArray(parsed.files) || !parsed.overallSummary) {
      return null;
    }

    // Compute stats if missing
    if (!parsed.stats) {
      const stats = { critical: 0, warning: 0, suggestion: 0, nitpick: 0 };
      for (const file of parsed.files) {
        for (const finding of file.findings || []) {
          if (finding.severity in stats) {
            stats[finding.severity as keyof typeof stats]++;
          }
        }
      }
      parsed.stats = stats;
    }

    // Ensure all files have findings array, IDs on findings, and deduplicate
    let idCounter = 0;
    for (const file of parsed.files as ReviewFileSummary[]) {
      file.findings = file.findings || [];
      for (const finding of file.findings) {
        if (!finding.id) {
          finding.id = `rf-${++idCounter}`;
        }
        if (!finding.file) {
          finding.file = file.path;
        }
      }

      // Deduplicate: merge findings with the same title in the same file
      const merged: typeof file.findings = [];
      for (const finding of file.findings) {
        const existing = merged.find(
          (f) => f.title === finding.title && f.severity === finding.severity
        );
        if (existing) {
          // Expand the line range to cover both
          existing.lineStart = Math.min(existing.lineStart, finding.lineStart);
          existing.lineEnd = Math.max(existing.lineEnd, finding.lineEnd);
        } else {
          merged.push(finding);
        }
      }
      file.findings = merged;
    }

    // Recompute stats after deduplication
    const recomputedStats = { critical: 0, warning: 0, suggestion: 0, nitpick: 0 };
    for (const file of parsed.files) {
      for (const finding of file.findings || []) {
        if (finding.severity in recomputedStats) {
          recomputedStats[finding.severity as keyof typeof recomputedStats]++;
        }
      }
    }
    parsed.stats = recomputedStats;

    return parsed as ReviewResultData;
  } catch {
    return null;
  }
}

// ─── Retriable Error Detection ──────────────────────────────────────────

const RETRIABLE_ERROR_PATTERNS = [
  // Billing / credit errors
  /credit balance is too low/i,
  /insufficient_quota/i,
  /billing.*not.*active/i,
  /exceeded.*quota/i,
  /payment.*required/i,
  // Rate limit errors
  /rate_limit_exceeded/i,
  /rate limit/i,
  /too many requests/i,
  /429/,
  // Auth errors
  /invalid_api_key/i,
  /authentication_error/i,
  /invalid.*api.*key/i,
  /unauthorized/i,
  /api key.*invalid/i,
  /permission.*denied/i,
  // Model availability mismatches (fallback to next preferred model)
  /model.*not.*supported/i,
  /copilot settings/i,
  // Provider/model returned an empty completion with no tokens
  /returned an empty completion/i,
  /outputtokens=0/i,
  /model returned an empty response/i,
];

function isRetriableProviderError(errorMsg: string): boolean {
  return RETRIABLE_ERROR_PATTERNS.some((pattern) => pattern.test(errorMsg));
}

// ─── Per-Channel Session State ──────────────────────────────────────────
// Each channel (web, telegram, slack, etc.) gets its own OpenCode session
// so prompts from different channels don't interfere with each other.

export class ChannelSession {
  readonly channelKey: string;
  opencodeSessionId: string | null = null;

  // Track current prompt so we can route events back to the DO
  activeMessageId: string | null = null;
  streamedContent = "";
  committedAssistantContent = "";
  hasActivity = false;
  lastChunkTime = 0;

  // Track tool states to detect completion (pending/running → completed)
  toolStates = new Map<string, { status: ToolStatus; toolName: string }>();
  // Track last full text by part ID when SSE omits incremental `delta`
  textPartSnapshots = new Map<string, string>();
  // Track last full text by message ID to handle providers that rotate part IDs
  // while emitting full-text snapshots (no true deltas).
  messageTextSnapshots = new Map<string, string>();
  // Track message roles so we can ignore user parts in SSE updates
  messageRoles = new Map<string, string>();
  // Assistant message IDs seen for the active DO prompt
  activeAssistantMessageIds = new Set<string>();
  // Latest full assistant text snapshot observed via message.updated
  latestAssistantTextSnapshot = "";
  // Compact event trace for debugging empty-response classification
  recentEventTrace: string[] = [];
  lastError: string | null = null;
  hadToolSinceLastText = false;
  idleNotified = false;

  // Message ID mapping: DO message IDs ↔ OpenCode message IDs
  doToOcMessageId = new Map<string, string>();
  ocToDOMessageId = new Map<string, string>();

  // Model failover state for current prompt
  currentModelPreferences: string[] | undefined;
  currentModelIndex = 0;
  pendingRetryContent: string | null = null;
  pendingRetryAttachments: PromptAttachment[] = [];
  pendingRetryAuthor: PromptAuthor | undefined;
  waitForEventForced = false;
  failoverInProgress = false;
  retryPending = false;
  finalizeInFlight = false;
  awaitingAssistantForAttempt = false;

  constructor(channelKey: string) {
    this.channelKey = channelKey;
  }

  /** Reset per-prompt state (called at start of each new prompt). */
  resetPromptState(): void {
    this.streamedContent = "";
    this.committedAssistantContent = "";
    this.hasActivity = false;
    this.hadToolSinceLastText = false;
    this.lastChunkTime = 0;
    this.lastError = null;
    this.toolStates.clear();
    this.textPartSnapshots.clear();
    this.messageTextSnapshots.clear();
    this.messageRoles.clear();
    this.activeAssistantMessageIds.clear();
    this.latestAssistantTextSnapshot = "";
    this.recentEventTrace = [];
    this.waitForEventForced = false;
    this.awaitingAssistantForAttempt = false;
  }

  /** Reset state for model failover retry (keep activeMessageId). */
  resetForRetry(): void {
    this.streamedContent = "";
    this.committedAssistantContent = "";
    this.hasActivity = false;
    this.hadToolSinceLastText = false;
    this.lastChunkTime = 0;
    this.lastError = null;
    this.toolStates.clear();
    this.textPartSnapshots.clear();
    this.messageTextSnapshots.clear();
    this.messageRoles.clear();
    this.activeAssistantMessageIds.clear();
    this.latestAssistantTextSnapshot = "";
    this.recentEventTrace = [];
    this.awaitingAssistantForAttempt = false;
  }

  /** Reset state on abort. */
  resetForAbort(): void {
    this.activeMessageId = null;
    this.streamedContent = "";
    this.committedAssistantContent = "";
    this.hasActivity = false;
    this.hadToolSinceLastText = false;
    this.lastChunkTime = 0;
    this.lastError = null;
    this.toolStates.clear();
    this.textPartSnapshots.clear();
    this.messageTextSnapshots.clear();
    this.messageRoles.clear();
    this.activeAssistantMessageIds.clear();
    this.latestAssistantTextSnapshot = "";
    this.recentEventTrace = [];
    this.awaitingAssistantForAttempt = false;
  }

  static channelKeyFrom(channelType?: string, channelId?: string): string {
    if (channelType && channelId) return `${channelType}:${channelId}`;
    return "web:default";
  }
}

export class PromptHandler {
  private opencodeUrl: string;
  private agentClient: AgentClient;
  private runnerSessionId: string | null;
  private eventStreamActive = false;
  private responseTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Per-channel OpenCode session state
  private channels = new Map<string, ChannelSession>();
  private ocSessionToChannel = new Map<string, ChannelSession>(); // reverse lookup for SSE routing

  // Active channel — set when a prompt arrives, used by methods that haven't been
  // updated to accept a channel parameter yet (backward compat bridge)
  private activeChannel: ChannelSession | null = null;

  // Legacy single-session compat — points to activeChannel's OC session ID
  // Used by ephemeral sessions, reviews, etc. that don't need per-channel routing
  private get sessionId(): string | null {
    return this.activeChannel?.opencodeSessionId ?? null;
  }
  private set sessionId(val: string | null) {
    if (this.activeChannel) {
      this.activeChannel.opencodeSessionId = val;
    }
  }

  // Delegate per-prompt fields to activeChannel for backward compat
  private get activeMessageId(): string | null { return this.activeChannel?.activeMessageId ?? null; }
  private set activeMessageId(val: string | null) { if (this.activeChannel) this.activeChannel.activeMessageId = val; }
  private get streamedContent(): string { return this.activeChannel?.streamedContent ?? ""; }
  private set streamedContent(val: string) { if (this.activeChannel) this.activeChannel.streamedContent = val; }
  private get committedAssistantContent(): string { return this.activeChannel?.committedAssistantContent ?? ""; }
  private set committedAssistantContent(val: string) { if (this.activeChannel) this.activeChannel.committedAssistantContent = val; }
  private get hasActivity(): boolean { return this.activeChannel?.hasActivity ?? false; }
  private set hasActivity(val: boolean) { if (this.activeChannel) this.activeChannel.hasActivity = val; }
  private get lastChunkTime(): number { return this.activeChannel?.lastChunkTime ?? 0; }
  private set lastChunkTime(val: number) { if (this.activeChannel) this.activeChannel.lastChunkTime = val; }
  private get toolStates(): Map<string, { status: ToolStatus; toolName: string }> { return this.activeChannel?.toolStates ?? new Map(); }
  private get textPartSnapshots(): Map<string, string> { return this.activeChannel?.textPartSnapshots ?? new Map(); }
  private get messageTextSnapshots(): Map<string, string> { return this.activeChannel?.messageTextSnapshots ?? new Map(); }
  private get messageRoles(): Map<string, string> { return this.activeChannel?.messageRoles ?? new Map(); }
  private get activeAssistantMessageIds(): Set<string> { return this.activeChannel?.activeAssistantMessageIds ?? new Set(); }
  private get latestAssistantTextSnapshot(): string { return this.activeChannel?.latestAssistantTextSnapshot ?? ""; }
  private set latestAssistantTextSnapshot(val: string) { if (this.activeChannel) this.activeChannel.latestAssistantTextSnapshot = val; }
  private get recentEventTrace(): string[] { return this.activeChannel?.recentEventTrace ?? []; }
  private set recentEventTrace(val: string[]) { if (this.activeChannel) this.activeChannel.recentEventTrace = val; }
  private get lastError(): string | null { return this.activeChannel?.lastError ?? null; }
  private set lastError(val: string | null) { if (this.activeChannel) this.activeChannel.lastError = val; }
  private get hadToolSinceLastText(): boolean { return this.activeChannel?.hadToolSinceLastText ?? false; }
  private set hadToolSinceLastText(val: boolean) { if (this.activeChannel) this.activeChannel.hadToolSinceLastText = val; }
  private get idleNotified(): boolean { return this.activeChannel?.idleNotified ?? false; }
  private set idleNotified(val: boolean) { if (this.activeChannel) this.activeChannel.idleNotified = val; }
  private get doToOcMessageId(): Map<string, string> { return this.activeChannel?.doToOcMessageId ?? new Map(); }
  private get ocToDOMessageId(): Map<string, string> { return this.activeChannel?.ocToDOMessageId ?? new Map(); }
  private get currentModelPreferences(): string[] | undefined { return this.activeChannel?.currentModelPreferences; }
  private set currentModelPreferences(val: string[] | undefined) { if (this.activeChannel) this.activeChannel.currentModelPreferences = val; }
  private get currentModelIndex(): number { return this.activeChannel?.currentModelIndex ?? 0; }
  private set currentModelIndex(val: number) { if (this.activeChannel) this.activeChannel.currentModelIndex = val; }
  private get pendingRetryContent(): string | null { return this.activeChannel?.pendingRetryContent ?? null; }
  private set pendingRetryContent(val: string | null) { if (this.activeChannel) this.activeChannel.pendingRetryContent = val; }
  private get pendingRetryAttachments(): PromptAttachment[] { return this.activeChannel?.pendingRetryAttachments ?? []; }
  private set pendingRetryAttachments(val: PromptAttachment[]) { if (this.activeChannel) this.activeChannel.pendingRetryAttachments = val; }
  private get pendingRetryAuthor(): PromptAuthor | undefined { return this.activeChannel?.pendingRetryAuthor; }
  private set pendingRetryAuthor(val: PromptAuthor | undefined) { if (this.activeChannel) this.activeChannel.pendingRetryAuthor = val; }
  private get waitForEventForced(): boolean { return this.activeChannel?.waitForEventForced ?? false; }
  private set waitForEventForced(val: boolean) { if (this.activeChannel) this.activeChannel.waitForEventForced = val; }
  private get failoverInProgress(): boolean { return this.activeChannel?.failoverInProgress ?? false; }
  private set failoverInProgress(val: boolean) { if (this.activeChannel) this.activeChannel.failoverInProgress = val; }
  private get retryPending(): boolean { return this.activeChannel?.retryPending ?? false; }
  private set retryPending(val: boolean) { if (this.activeChannel) this.activeChannel.retryPending = val; }
  private get finalizeInFlight(): boolean { return this.activeChannel?.finalizeInFlight ?? false; }
  private set finalizeInFlight(val: boolean) { if (this.activeChannel) this.activeChannel.finalizeInFlight = val; }
  private get awaitingAssistantForAttempt(): boolean { return this.activeChannel?.awaitingAssistantForAttempt ?? false; }
  private set awaitingAssistantForAttempt(val: boolean) { if (this.activeChannel) this.activeChannel.awaitingAssistantForAttempt = val; }

  // Ephemeral session tracking — resolved when the session becomes idle via SSE
  private idleWaiters = new Map<string, () => void>();
  private ephemeralContent = new Map<string, string>(); // accumulated text from SSE

  // OpenCode question requests (question tool)
  private pendingQuestionRequests = new Map<string, { answers: (string[] | null)[] }>();
  private promptToQuestion = new Map<string, { requestID: string; index: number }>();
  private workflowExecutionModel: string | undefined;
  private workflowExecutionModelPreferences: string[] | undefined;

  constructor(opencodeUrl: string, agentClient: AgentClient, runnerSessionId?: string) {
    this.opencodeUrl = opencodeUrl;
    this.agentClient = agentClient;
    this.runnerSessionId = runnerSessionId?.trim() || null;
  }

  /** Get or create a ChannelSession for the given channel. */
  getOrCreateChannel(channelType?: string, channelId?: string): ChannelSession {
    const key = ChannelSession.channelKeyFrom(channelType, channelId);
    let ch = this.channels.get(key);
    if (!ch) {
      ch = new ChannelSession(key);
      this.channels.set(key, ch);
    }
    return ch;
  }

  private applyPersistedOpenCodeSessionId(channel: ChannelSession, opencodeSessionId?: string): void {
    const persisted = typeof opencodeSessionId === "string" ? opencodeSessionId.trim() : "";
    if (!persisted) return;
    if (channel.opencodeSessionId === persisted) return;

    if (channel.opencodeSessionId) {
      this.ocSessionToChannel.delete(channel.opencodeSessionId);
    }
    channel.opencodeSessionId = persisted;
    this.ocSessionToChannel.set(persisted, channel);
  }

  private buildModelFailoverChain(primaryModel?: string, modelPreferences?: string[]): string[] {
    const chain: string[] = [];
    const pushModel = (candidate: string | undefined) => {
      const normalized = typeof candidate === "string" ? candidate.trim() : "";
      if (!normalized) return;
      if (!chain.includes(normalized)) chain.push(normalized);
    };
    pushModel(primaryModel);
    for (const candidate of modelPreferences ?? []) {
      pushModel(candidate);
    }
    return chain;
  }

  private async ensureChannelOpenCodeSession(channel: ChannelSession): Promise<string> {
    if (!channel.opencodeSessionId) {
      channel.opencodeSessionId = await this.createSession();
      this.ocSessionToChannel.set(channel.opencodeSessionId, channel);
      this.agentClient.sendChannelSessionCreated(channel.channelKey, channel.opencodeSessionId);
    }
    if (!this.eventStreamActive) {
      await this.startEventStream();
    }
    return channel.opencodeSessionId;
  }

  private async recreateChannelOpenCodeSession(channel: ChannelSession): Promise<string> {
    const oldId = channel.opencodeSessionId;
    if (oldId) {
      this.ocSessionToChannel.delete(oldId);
    }
    channel.opencodeSessionId = await this.createSession();
    this.ocSessionToChannel.set(channel.opencodeSessionId, channel);
    this.agentClient.sendChannelSessionCreated(channel.channelKey, channel.opencodeSessionId);
    if (!this.eventStreamActive) {
      await this.startEventStream();
    }
    return channel.opencodeSessionId;
  }

  private async sendPromptToChannelWithRecovery(
    channel: ChannelSession,
    content: string,
    options?: {
      model?: string;
      attachments?: PromptAttachment[];
      author?: PromptAuthor;
      channelType?: string;
      channelId?: string;
    },
  ): Promise<string> {
    const currentSessionId = await this.ensureChannelOpenCodeSession(channel);
    try {
      await this.sendPromptAsync(
        currentSessionId,
        content,
        options?.model,
        options?.attachments,
        options?.author,
        options?.channelType,
        options?.channelId,
      );
      return currentSessionId;
    } catch (err) {
      if (!this.isSessionGone(err)) {
        throw err;
      }
      console.warn("[PromptHandler] OpenCode session missing; recreating session and retrying prompt");
      const recreatedSessionId = await this.recreateChannelOpenCodeSession(channel);
      await this.sendPromptAsync(
        recreatedSessionId,
        content,
        options?.model,
        options?.attachments,
        options?.author,
        options?.channelType,
        options?.channelId,
      );
      return recreatedSessionId;
    }
  }

  private extractChannelContext(channel: ChannelSession): { channelType?: string; channelId?: string } {
    const idx = channel.channelKey.indexOf(":");
    if (idx <= 0 || idx >= channel.channelKey.length - 1) {
      return {};
    }
    return {
      channelType: channel.channelKey.slice(0, idx),
      channelId: channel.channelKey.slice(idx + 1),
    };
  }


  private normalizeWorkflowHash(hash: string | undefined): string {
    const cleaned = (hash || "").trim();
    if (!cleaned) return "";
    return cleaned.startsWith("sha256:") ? cleaned : `sha256:${cleaned}`;
  }

  private async handleWorkflowExecutionPrompt(
    messageId: string,
    request: WorkflowExecutionDispatchPayload,
    options?: { emitChatError?: boolean; model?: string; modelPreferences?: string[] },
  ): Promise<void> {
    const executionId = request.executionId;
    const emitChatError = options?.emitChatError !== false;
    this.agentClient.sendAgentStatus("thinking");

    const fail = async (error: string) => {
      this.agentClient.sendWorkflowExecutionResult(executionId, {
        ok: false,
        status: "failed",
        executionId,
        output: {},
        steps: [],
        requiresApproval: null,
        error,
      });
      if (emitChatError) {
        this.agentClient.sendError(messageId, error);
      }
      this.agentClient.sendAgentStatus("idle");
      this.agentClient.sendComplete();
    };

    const previousWorkflowModel = this.workflowExecutionModel;
    const previousWorkflowModelPrefs = this.workflowExecutionModelPreferences;
    const normalizedDispatchModel = typeof options?.model === "string" && options.model.trim()
      ? options.model.trim()
      : undefined;
    const normalizedDispatchPrefs = Array.isArray(options?.modelPreferences)
      ? options.modelPreferences
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : [];
    this.workflowExecutionModel = normalizedDispatchModel;
    this.workflowExecutionModelPreferences = normalizedDispatchPrefs.length > 0 ? normalizedDispatchPrefs : undefined;

    try {
      const workflowValue = request.payload.workflow;
      if (!workflowValue || typeof workflowValue !== "object" || Array.isArray(workflowValue)) {
        await fail("Workflow execution payload missing workflow object");
        return;
      }

      const compiled = await compileWorkflowDefinition(workflowValue);
      if (!compiled.ok || !compiled.workflow || !compiled.workflowHash) {
        await fail(compiled.errors[0]?.message || "Workflow compilation failed");
        return;
      }

      const expectedHash = this.normalizeWorkflowHash(request.workflowHash);
      const compiledHash = this.normalizeWorkflowHash(compiled.workflowHash);
      if (expectedHash && expectedHash !== compiledHash) {
        await fail(`Workflow hash mismatch: expected ${expectedHash}, got ${compiledHash}`);
        return;
      }

      const payload = request.payload as WorkflowRunPayload & Record<string, unknown>;
      const runPayload: WorkflowRunPayload = {
        trigger: payload.trigger as Record<string, unknown> | undefined,
        variables: payload.variables as Record<string, unknown> | undefined,
        runtime: payload.runtime as WorkflowRunPayload["runtime"] | undefined,
      };
      const hooks = {
        onToolStep: (step: NormalizedWorkflowStep, context: WorkflowStepExecutionContext) =>
          this.executeWorkflowToolStep(step, context),
        onAgentStep: (step: NormalizedWorkflowStep, context: WorkflowStepExecutionContext) =>
          this.executeWorkflowAgentStep(step, context),
      };

      const envelope = request.kind === "run"
        ? await executeWorkflowRun(executionId, compiled.workflow, runPayload, hooks)
        : await executeWorkflowResume(
            executionId,
            compiled.workflow,
            runPayload,
            request.resumeToken || "",
            request.decision === "deny" ? "deny" : "approve",
            hooks,
          );

      this.agentClient.sendWorkflowExecutionResult(executionId, {
        ok: envelope.ok,
        status: envelope.status,
        executionId: envelope.executionId,
        output: envelope.output,
        steps: envelope.steps,
        requiresApproval: envelope.requiresApproval,
        error: envelope.error,
      });
      this.agentClient.sendAgentStatus("idle");
      this.agentClient.sendComplete();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await fail(message);
    } finally {
      this.workflowExecutionModel = previousWorkflowModel;
      this.workflowExecutionModelPreferences = previousWorkflowModelPrefs;
    }
  }

  async handleWorkflowExecutionDispatch(
    executionId: string,
    payload: WorkflowExecutionDispatchPayload,
    model?: string,
    modelPreferences?: string[],
  ): Promise<void> {
    const request: WorkflowExecutionDispatchPayload = {
      ...payload,
      executionId: payload.executionId || executionId,
    };
    await this.handleWorkflowExecutionPrompt(`workflow:${executionId}`, request, {
      emitChatError: false,
      model,
      modelPreferences,
    });
  }

  private async executeWorkflowToolStep(
    step: NormalizedWorkflowStep,
    _context: WorkflowStepExecutionContext,
  ): Promise<WorkflowStepExecutionResult | void> {
    if (typeof step.tool !== "string") {
      return;
    }

    const tool = step.tool;
    const args = isRecord(step.arguments) ? step.arguments : {};

    switch (tool) {
      case "spawn_session": {
        const task = typeof args.task === "string" ? args.task.trim() : "";
        const workspace = typeof args.workspace === "string" ? args.workspace.trim() : "";
        if (!task || !workspace) {
          return { status: "failed", error: "spawn_session requires task and workspace" };
        }
        const result = await this.agentClient.requestSpawnChild({
          task,
          workspace,
          repoUrl: typeof args.repoUrl === "string" ? args.repoUrl : undefined,
          branch: typeof args.branch === "string" ? args.branch : undefined,
          ref: typeof args.ref === "string" ? args.ref : undefined,
          title: typeof args.title === "string" ? args.title : undefined,
          model: typeof args.model === "string" ? args.model : undefined,
        });
        return {
          status: "completed",
          output: { tool, childSessionId: result.childSessionId },
        };
      }

      case "send_message": {
        const targetSessionId = typeof args.targetSessionId === "string" ? args.targetSessionId.trim() : "";
        const content = typeof args.content === "string" ? args.content : "";
        if (!targetSessionId || !content) {
          return { status: "failed", error: "send_message requires targetSessionId and content" };
        }
        const interrupt = args.interrupt === true;
        const result = await this.agentClient.requestSendMessage(targetSessionId, content, interrupt);
        return {
          status: "completed",
          output: { tool, targetSessionId, success: result.success },
        };
      }

      case "list_workflows": {
        const result = await this.agentClient.requestListWorkflows();
        return { status: "completed", output: { tool, workflows: result.workflows } };
      }

      case "run_workflow": {
        const workflowId = typeof args.workflowId === "string" ? args.workflowId.trim() : "";
        if (!workflowId) {
          return { status: "failed", error: "run_workflow requires workflowId" };
        }
        const variables = isRecord(args.variables) ? args.variables : undefined;
        const repoUrl = typeof args.repoUrl === "string" ? args.repoUrl.trim() : "";
        const branch = typeof args.branch === "string" ? args.branch.trim() : "";
        const ref = typeof args.ref === "string" ? args.ref.trim() : "";
        const sourceRepoFullName = typeof args.sourceRepoFullName === "string" ? args.sourceRepoFullName.trim() : "";
        const result = await this.agentClient.requestRunWorkflow(
          workflowId,
          variables,
          {
            repoUrl: repoUrl || undefined,
            branch: branch || undefined,
            ref: ref || undefined,
            sourceRepoFullName: sourceRepoFullName || undefined,
          },
        );
        return { status: "completed", output: { tool, execution: result.execution } };
      }

      case "list_workflow_executions": {
        const workflowId = typeof args.workflowId === "string" ? args.workflowId : undefined;
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const result = await this.agentClient.requestListWorkflowExecutions(workflowId, limit);
        return { status: "completed", output: { tool, executions: result.executions } };
      }
    }

    return;
  }

  private async executeWorkflowAgentStep(
    step: NormalizedWorkflowStep,
    context: WorkflowStepExecutionContext,
  ): Promise<WorkflowStepExecutionResult | void> {
    if (step.type !== "agent_message") {
      return;
    }

    const content = (
      typeof step.content === "string"
        ? step.content
        : typeof step.message === "string"
          ? step.message
          : typeof step.goal === "string"
            ? step.goal
            : ""
    ).trim();

    if (!content) {
      return { status: "failed", error: "agent_message requires content/message/goal" };
    }

    if (!this.runnerSessionId) {
      return { status: "failed", error: "agent_message unavailable: runner session id is missing" };
    }

    const interrupt = step.interrupt === true;
    const awaitResponse = step.await_response === true || step.awaitResponse === true;
    const awaitTimeoutRaw =
      typeof step.await_timeout_ms === "number"
        ? step.await_timeout_ms
        : typeof step.awaitTimeoutMs === "number"
          ? step.awaitTimeoutMs
          : 120_000;
    const awaitTimeoutMs = Math.max(1_000, Math.min(awaitTimeoutRaw, 900_000));
    const previousChannel = this.activeChannel;
    const modelChain = this.buildModelFailoverChain(
      this.workflowExecutionModel,
      this.workflowExecutionModelPreferences,
    );
    const preferredModel = modelChain[0];

    try {
      const workflowChannelType = "workflow";
      const workflowChannelId = context.executionId;
      const channel = this.getOrCreateChannel(workflowChannelType, workflowChannelId);
      this.activeChannel = channel;
      await this.ensureChannelOpenCodeSession(channel);

      this.agentClient.sendWorkflowChatMessage("user", content, {
        workflowExecutionId: context.executionId,
        workflowStepId: step.id,
        kind: "agent_message",
      }, {
        channelType: workflowChannelType,
        channelId: workflowChannelId,
        opencodeSessionId: channel.opencodeSessionId ?? undefined,
      });

      if (interrupt) {
        const sessionId = channel.opencodeSessionId;
        if (sessionId) {
          await fetch(`${this.opencodeUrl}/session/${sessionId}/abort`, { method: "POST" }).catch(() => undefined);
        }
      }

      if (!awaitResponse) {
        await this.sendPromptToChannelWithRecovery(channel, content, {
          model: preferredModel,
          channelType: workflowChannelType,
          channelId: workflowChannelId,
        });
        return {
          status: "completed",
          output: {
            type: "agent_message",
            targetSessionId: this.runnerSessionId,
            content,
            interrupt,
            awaitResponse: false,
            success: true,
          },
        };
      }

      const attemptSessionIds = new Set<string>();
      try {
        let lastFailure: string | null = null;
        const candidates = modelChain.length > 0 ? modelChain : [undefined];

        for (const modelCandidate of candidates) {
          channel.resetPromptState();
          channel.lastError = null;
          let sessionId = await this.ensureChannelOpenCodeSession(channel);
          this.ephemeralContent.set(sessionId, "");
          attemptSessionIds.add(sessionId);
          let idlePromise = this.pollUntilIdle(sessionId, awaitTimeoutMs);

          const sentSessionId = await this.sendPromptToChannelWithRecovery(channel, content, {
            model: modelCandidate,
            channelType: workflowChannelType,
            channelId: workflowChannelId,
          });
          if (sentSessionId !== sessionId) {
            this.ephemeralContent.delete(sessionId);
            this.idleWaiters.delete(sessionId);
            sessionId = sentSessionId;
            this.ephemeralContent.set(sessionId, "");
            attemptSessionIds.add(sessionId);
            idlePromise = this.pollUntilIdle(sessionId, awaitTimeoutMs);
          }

          await idlePromise;

          const responseText = (this.ephemeralContent.get(sessionId) || "").trim();
          const stepError = channel.lastError || null;

          let recoveredResponse = responseText;
          if (!recoveredResponse) {
            const recovered = await this.recoverAssistantTextOrError();
            if (recovered.text) {
              recoveredResponse = recovered.text;
            } else if (recovered.error) {
              lastFailure = recovered.error;
              channel.lastError = recovered.error;
              this.lastError = recovered.error;
              if (!isRetriableProviderError(recovered.error)) {
                break;
              }
              continue;
            }
          }

          if (recoveredResponse) {
            this.agentClient.sendWorkflowChatMessage("assistant", recoveredResponse, {
              workflowExecutionId: context.executionId,
              workflowStepId: step.id,
              kind: "agent_message_response",
            }, {
              channelType: workflowChannelType,
              channelId: workflowChannelId,
              opencodeSessionId: channel.opencodeSessionId ?? undefined,
            });

            return {
              status: "completed",
              output: {
                type: "agent_message",
                targetSessionId: this.runnerSessionId,
                content,
                interrupt,
                awaitResponse: true,
                awaitTimeoutMs,
                response: recoveredResponse,
                model: modelCandidate || null,
              },
            };
          }

          if (stepError) {
            lastFailure = stepError;
            if (!isRetriableProviderError(stepError)) {
              break;
            }
          } else {
            lastFailure = "agent_message_empty_response";
          }
        }

        return {
          status: "failed",
          error: lastFailure || "agent_message_empty_response",
          output: {
            type: "agent_message",
            targetSessionId: this.runnerSessionId,
            content,
            interrupt,
            awaitResponse: true,
            awaitTimeoutMs,
          },
        };
      } finally {
        for (const sessionId of attemptSessionIds) {
          this.ephemeralContent.delete(sessionId);
          this.idleWaiters.delete(sessionId);
        }
      }
    } catch (error) {
      return {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        output: {
          type: "agent_message",
          targetSessionId: this.runnerSessionId,
          content,
          interrupt,
        },
      };
    } finally {
      this.activeChannel = previousChannel;
    }
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

  async handlePrompt(messageId: string, content: string, model?: string, author?: { authorId?: string; gitName?: string; gitEmail?: string; authorName?: string; authorEmail?: string }, modelPreferences?: string[], attachments?: PromptAttachment[], channelType?: string, channelId?: string, opencodeSessionId?: string): Promise<void> {
    console.log(`[PromptHandler] Handling prompt ${messageId}: "${content.slice(0, 80)}"${model ? ` (model: ${model})` : ''}${author?.authorName ? ` (by: ${author.authorName})` : ''}${modelPreferences?.length ? ` (prefs: ${modelPreferences.length})` : ''}${attachments?.length ? ` (attachments: ${attachments.length})` : ''}${channelType ? ` (channel: ${channelType})` : ''}`);

    // Resolve per-channel session
    const channel = this.getOrCreateChannel(channelType, channelId);
    this.activeChannel = channel;
    this.applyPersistedOpenCodeSessionId(channel, opencodeSessionId);

    try {
      // Set git config for author attribution before processing
      if (author?.gitName || author?.authorName) {
        const name = author.gitName || author.authorName;
        const email = author.gitEmail || author.authorEmail;
        try {
          const nameProc = Bun.spawn(['git', 'config', '--global', 'user.name', name!]);
          await nameProc.exited;
          if (email) {
            const emailProc = Bun.spawn(['git', 'config', '--global', 'user.email', email]);
            await emailProc.exited;
          }
        } catch (err) {
          console.warn('[PromptHandler] Failed to set git config:', err);
        }
      }

      // If there's a pending response from a previous prompt on this channel, finalize it first
      if (channel.activeMessageId && channel.hasActivity) {
        console.log(`[PromptHandler] Finalizing previous response before new prompt`);
        this.finalizeResponse();
      }

      // Clear any pending timeout from previous prompt
      this.clearResponseTimeout();

      // Ensure this channel has an OpenCode session and active SSE stream.
      await this.ensureChannelOpenCodeSession(channel);

      channel.activeMessageId = messageId;
      channel.resetPromptState();

      // Build failover chain with explicit model first (if provided), then
      // user preferences. This keeps failover anchored to the actual selected model.
      const failoverChain = this.buildModelFailoverChain(model, modelPreferences);

      // Transcribe audio attachments before sending to OpenCode
      let effectiveContent = content;
      let effectiveAttachments = attachments ?? [];
      const hasAudio = effectiveAttachments.some(a => a.mime.startsWith('audio/'));
      if (hasAudio) {
        let transcribed = false;
        try {
          const { transcriptions, remaining } = await this.transcribeAudioAttachments(effectiveAttachments);
          if (transcriptions.length > 0) {
            transcribed = true;
            const transcriptText = transcriptions.join('\n\n');
            const transcriptBlock = transcriptions.map(t => `[Transcribed voice note]\n${t}`).join('\n\n');
            effectiveContent = effectiveContent
              ? `${transcriptBlock}\n\n${effectiveContent}`
              : transcriptBlock;
            // Send transcript back to DO so UI can display it alongside audio player
            this.agentClient.sendAudioTranscript(messageId, transcriptText);
          }
          effectiveAttachments = remaining;
        } catch (err) {
          console.error('[PromptHandler] Failed to transcribe audio:', err);
        }
        // Strip audio from what goes to OpenCode — it can't process audio files
        effectiveAttachments = effectiveAttachments.filter(a => !a.mime.startsWith('audio/'));
        // If transcription failed and content is empty, provide a fallback so the prompt isn't empty
        if (!transcribed && !effectiveContent?.trim()) {
          effectiveContent = '[The user sent a voice note but transcription is unavailable. Please ask them to type their message instead.]';
        }
      }

      // Store failover state (use post-transcription values so model failover doesn't re-transcribe)
      this.currentModelPreferences = failoverChain.length > 0 ? failoverChain : undefined;
      this.pendingRetryContent = effectiveContent;
      this.pendingRetryAttachments = effectiveAttachments;
      this.pendingRetryAuthor = author;

      // Determine which model to use: explicit model takes priority, then first preference
      const effectiveModel = failoverChain[0];
      this.currentModelIndex = 0;

      // Notify client that agent is thinking
      this.agentClient.sendAgentStatus("thinking");
      this.awaitingAssistantForAttempt = true;

      // Send message async (fire-and-forget)
      await this.sendPromptToChannelWithRecovery(channel, effectiveContent, {
        model: effectiveModel,
        attachments: effectiveAttachments,
        author,
        channelType,
        channelId,
      });
      console.log(`[PromptHandler] Prompt ${messageId} sent to OpenCode (channel: ${channel.channelKey})${effectiveModel ? ` (model: ${effectiveModel})` : ''}`);

      // Response will arrive via SSE events — don't block here
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[PromptHandler] Error processing prompt:", errorMsg);
      this.agentClient.sendError(messageId, errorMsg);
      this.agentClient.sendComplete();
    }
  }

  /**
   * Attempt to failover to the next model in preferences.
   * Returns true if failover was initiated, false if no more models.
   */
  private async attemptModelFailover(errorMsg: string): Promise<boolean> {
    if (!this.currentModelPreferences || this.currentModelPreferences.length === 0) {
      return false;
    }

    const nextIndex = this.currentModelIndex + 1;
    if (nextIndex >= this.currentModelPreferences.length) {
      console.log(`[PromptHandler] No more models to failover to (tried ${this.currentModelPreferences.length})`);
      return false;
    }

    const fromModel = this.currentModelPreferences[this.currentModelIndex] || "default";
    const toModel = this.currentModelPreferences[nextIndex];
    this.currentModelIndex = nextIndex;

    console.log(`[PromptHandler] Failing over from ${fromModel} to ${toModel} due to: ${errorMsg}`);

    // Notify DO about the switch
    if (this.activeMessageId) {
      this.agentClient.sendModelSwitched(this.activeMessageId, fromModel, toModel, errorMsg);
    }

    // Reset stream state for retry (keep activeMessageId)
    if (this.activeChannel) this.activeChannel.resetForRetry();

    // Retry with next model
    try {
      this.agentClient.sendAgentStatus("thinking");
      this.awaitingAssistantForAttempt = true;
      const activeChannel = this.activeChannel;
      if (!activeChannel) throw new Error("No active channel for failover retry");
      const channelContext = this.extractChannelContext(activeChannel);
      await this.sendPromptToChannelWithRecovery(activeChannel, this.pendingRetryContent!, {
        model: toModel,
        attachments: this.pendingRetryAttachments,
        author: this.pendingRetryAuthor,
        channelType: channelContext.channelType,
        channelId: channelContext.channelId,
      });
      console.log(`[PromptHandler] Retry sent with model ${toModel}`);
      return true;
    } catch (err) {
      console.error(`[PromptHandler] Failed to retry with model ${toModel}:`, err);
      return false;
    }
  }

  async handleAnswer(questionId: string, answer: string | boolean): Promise<void> {
    if (!this.sessionId) return;
    if (await this.handleQuestionReply(questionId, answer)) return;

    const response =
      answer === false || answer === "__expired__"
        ? "reject"
        : "always";
    await this.respondToPermission(questionId, response);
  }

  private async approvePermission(permissionId: string): Promise<void> {
    await this.respondToPermission(permissionId, "always");
  }

  private async respondToPermission(permissionId: string, response: "once" | "always" | "reject"): Promise<void> {
    if (!this.sessionId) return;
    await this.respondToPermissionOnSession(this.sessionId, permissionId, response);
  }

  private async respondToPermissionOnSession(sessionId: string, permissionId: string, response: "once" | "always" | "reject"): Promise<void> {
    try {
      const url = `${this.opencodeUrl}/session/${sessionId}/permissions/${permissionId}`;
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

  private async handleQuestionReply(promptId: string, answer: string | boolean): Promise<boolean> {
    const mapping = this.promptToQuestion.get(promptId);
    if (!mapping) return false;

    this.promptToQuestion.delete(promptId);
    const request = this.pendingQuestionRequests.get(mapping.requestID);
    if (!request) return true;

    if (answer === "__expired__") {
      await this.rejectQuestionRequest(mapping.requestID, "expired");
      return true;
    }

    const normalized = this.normalizeQuestionAnswer(answer);
    request.answers[mapping.index] = normalized;

    const complete = request.answers.every((item) => item !== null);
    if (!complete) return true;

    const answers = request.answers.map((item) => item ?? []);
    await this.replyQuestionRequest(mapping.requestID, answers);
    return true;
  }

  private normalizeQuestionAnswer(answer: string | boolean): string[] {
    if (answer === true) return ["true"];
    if (answer === false) return ["false"];
    const trimmed = String(answer).trim();
    if (!trimmed || trimmed === "__expired__") return [];
    return [trimmed];
  }

  private async replyQuestionRequest(requestID: string, answers: string[][]): Promise<void> {
    try {
      const url = `${this.opencodeUrl}/question/${requestID}/reply`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      console.log(`[PromptHandler] Question ${requestID} replied: ${res.status}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.warn(`[PromptHandler] Question reply failed: ${res.status} ${body}`);
      }
    } catch (err) {
      console.error("[PromptHandler] Error replying to question:", err);
    } finally {
      this.clearQuestionRequest(requestID);
    }
  }

  private async rejectQuestionRequest(requestID: string, reason: "expired" | "rejected"): Promise<void> {
    try {
      const url = `${this.opencodeUrl}/question/${requestID}/reject`;
      const res = await fetch(url, { method: "POST" });
      console.log(`[PromptHandler] Question ${requestID} rejected (${reason}): ${res.status}`);
    } catch (err) {
      console.error("[PromptHandler] Error rejecting question:", err);
    } finally {
      this.clearQuestionRequest(requestID);
    }
  }

  private clearQuestionRequest(requestID: string): void {
    this.pendingQuestionRequests.delete(requestID);
    for (const [promptID, mapping] of this.promptToQuestion.entries()) {
      if (mapping.requestID === requestID) {
        this.promptToQuestion.delete(promptID);
      }
    }
  }

  private handleQuestionAsked(properties: Record<string, unknown>): void {
    const requestID = typeof properties.id === "string" ? properties.id : "";
    const questionsRaw = Array.isArray(properties.questions) ? properties.questions : [];
    const parsedQuestions = questionsRaw
      .map((entry) => this.parseQuestionInfo(entry))
      .filter((entry): entry is { text: string; options?: string[] } => !!entry);

    if (!requestID || parsedQuestions.length === 0) {
      console.warn("[PromptHandler] question.asked missing request id or questions");
      return;
    }

    this.clearQuestionRequest(requestID);
    this.pendingQuestionRequests.set(requestID, {
      answers: Array.from({ length: parsedQuestions.length }, () => null),
    });

    parsedQuestions.forEach((question, index) => {
      const promptID = parsedQuestions.length === 1 ? requestID : `${requestID}:${index}`;
      this.promptToQuestion.set(promptID, { requestID, index });
      this.agentClient.sendQuestion(promptID, question.text, question.options);
    });
  }

  private parseQuestionInfo(input: unknown): { text: string; options?: string[] } | null {
    if (!isRecord(input)) return null;
    const question = input as OpenCodeQuestionInfo;

    const questionText = typeof question.question === "string" ? question.question.trim() : "";
    const header = typeof question.header === "string" ? question.header.trim() : "";
    if (!questionText && !header) return null;

    const text = header && questionText ? `${header}: ${questionText}` : (questionText || header);

    const optionLabels = Array.isArray(question.options)
      ? question.options
          .map((opt) => (isRecord(opt) && typeof opt.label === "string" ? opt.label.trim() : ""))
          .filter(Boolean)
      : [];

    if (question.multiple) {
      const hint = optionLabels.length
        ? `\nOptions: ${optionLabels.join(", ")}\nSelect one or more values (comma-separated if needed).`
        : "\nSelect one or more values (comma-separated if needed).";
      return { text: `${text}${hint}` };
    }

    return { text, options: optionLabels.length > 0 ? optionLabels : undefined };
  }

  async handleAbort(channelType?: string, channelId?: string): Promise<void> {
    // If channel is specified, abort only that channel; otherwise abort all
    const targetChannels: ChannelSession[] = [];
    if (channelType && channelId) {
      const key = ChannelSession.channelKeyFrom(channelType, channelId);
      const ch = this.channels.get(key);
      if (ch) targetChannels.push(ch);
    } else {
      // Abort all active channels
      for (const ch of this.channels.values()) {
        if (ch.opencodeSessionId) targetChannels.push(ch);
      }
    }

    if (targetChannels.length === 0) return;

    console.log(`[PromptHandler] Aborting ${targetChannels.length} channel(s): ${targetChannels.map(c => c.channelKey).join(', ')}`);

    // Clear prompt state BEFORE the fetch so the SSE handler stops
    // forwarding events immediately (handlePartUpdated checks activeMessageId)
    this.clearResponseTimeout();
    for (const ch of targetChannels) {
      ch.resetForAbort();
      ch.idleNotified = true;
    }

    // Tell DO first so clients get immediate feedback
    this.agentClient.sendAborted();
    this.agentClient.sendAgentStatus("idle");

    // Then tell OpenCode to stop generating for each channel (may be slow)
    for (const ch of targetChannels) {
      if (!ch.opencodeSessionId) continue;
      try {
        const res = await fetch(`${this.opencodeUrl}/session/${ch.opencodeSessionId}/abort`, {
          method: "POST",
        });
        console.log(`[PromptHandler] Abort response for channel ${ch.channelKey}: ${res.status}`);
      } catch (err) {
        console.error(`[PromptHandler] Error calling abort for channel ${ch.channelKey}:`, err);
      }
    }
  }

  async handleNewSession(channelType: string, channelId: string, requestId: string): Promise<void> {
    const channel = this.getOrCreateChannel(channelType, channelId);

    // Delete old OpenCode session if it exists
    if (channel.opencodeSessionId) {
      const oldId = channel.opencodeSessionId;
      this.ocSessionToChannel.delete(oldId);
      try {
        await this.deleteSession(oldId);
      } catch (err) {
        console.warn(`[PromptHandler] Failed to delete old session ${oldId}:`, err);
      }
    }

    // Create fresh session
    channel.opencodeSessionId = await this.createSession();
    this.ocSessionToChannel.set(channel.opencodeSessionId, channel);
    channel.resetPromptState();

    // Notify DO
    this.agentClient.sendChannelSessionCreated(channel.channelKey, channel.opencodeSessionId);
    this.agentClient.sendSessionReset(channelType, channelId, requestId);

    console.log(`[PromptHandler] Session rotated for ${channel.channelKey} -> ${channel.opencodeSessionId}`);
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
      const files = await this.fetchDiffFiles();
      console.log(`[PromptHandler] Diff: ${files.length} files`);
      this.agentClient.sendDiff(requestId, files);
    } catch (err) {
      console.error("[PromptHandler] Error fetching diff:", err);
      this.agentClient.sendDiff(requestId, []);
    }
  }

  async executeOpenCodeCommand(command: string, args: string | undefined, requestId: string): Promise<void> {
    if (!this.sessionId) {
      this.agentClient.sendCommandResult(requestId, command, undefined, 'No active session');
      return;
    }

    console.log(`[PromptHandler] Executing OpenCode command: /${command}${args ? ' ' + args : ''}`);
    try {
      const body: Record<string, unknown> = { command: `/${command}` };
      if (args) body.args = args;
      const res = await fetch(
        `${this.opencodeUrl}/session/${this.sessionId}/command`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        this.agentClient.sendCommandResult(requestId, command, undefined, `OpenCode returned ${res.status}: ${errText}`);
        return;
      }
      const result = await res.json().catch(() => ({ ok: true }));
      this.agentClient.sendCommandResult(requestId, command, result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[PromptHandler] OpenCode command error:`, errMsg);
      this.agentClient.sendCommandResult(requestId, command, undefined, errMsg);
    }
  }

  async handleReview(requestId: string): Promise<void> {
    console.log(`[PromptHandler] Starting review for request ${requestId}`);
    try {
      // 1. Fetch diff
      const diffFiles = await this.fetchDiffFiles();
      if (diffFiles.length === 0) {
        this.agentClient.sendReviewResult(requestId, undefined, [], "No file changes to review.");
        return;
      }

      // 2. Build review prompt
      const diffText = diffFiles
        .map((f) => `--- ${f.status.toUpperCase()}: ${f.path} ---\n${f.diff || "(no diff)"}`)
        .join("\n\n");
      const prompt = REVIEW_PROMPT + diffText;

      // 3. Create ephemeral session and register for SSE content capture
      const ephemeralId = await this.createEphemeralSession();
      this.ephemeralContent.set(ephemeralId, "");
      console.log(`[PromptHandler] Created ephemeral session ${ephemeralId} for review`);

      try {
        // 4. Register idle waiter BEFORE sending prompt (avoid race)
        const idlePromise = this.pollUntilIdle(ephemeralId, REVIEW_TIMEOUT_MS);

        // 5. Send review prompt
        await this.sendPromptAsync(ephemeralId, prompt);

        // 6. Wait until idle
        await idlePromise;

        // 7. Get accumulated content from SSE events
        const content = this.ephemeralContent.get(ephemeralId) || "";
        console.log(`[PromptHandler] Ephemeral session response: ${content.length} chars`);

        if (!content) {
          this.agentClient.sendReviewResult(requestId, undefined, diffFiles, "No response received from review session");
          return;
        }

        const parsed = parseReviewResponse(content);
        if (!parsed) {
          console.log(`[PromptHandler] Failed to parse review response, first 500 chars: ${content.slice(0, 500)}`);
          this.agentClient.sendReviewResult(requestId, undefined, diffFiles, "Failed to parse review response");
          return;
        }

        console.log(`[PromptHandler] Review complete: ${parsed.files.length} files, ${parsed.stats.critical}C/${parsed.stats.warning}W/${parsed.stats.suggestion}S`);
        this.agentClient.sendReviewResult(requestId, parsed, diffFiles);
      } finally {
        // 8. Always clean up
        this.ephemeralContent.delete(ephemeralId);
        this.idleWaiters.delete(ephemeralId);
        await this.deleteSession(ephemeralId).catch((err) =>
          console.warn(`[PromptHandler] Failed to delete ephemeral session ${ephemeralId}:`, err)
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error("[PromptHandler] Review error:", errorMsg);
      this.agentClient.sendReviewResult(requestId, undefined, undefined, errorMsg);
    }
  }

  private async fetchDiffFiles(): Promise<DiffFile[]> {
    if (!this.sessionId) return [];

    const res = await fetch(`${this.opencodeUrl}/session/${this.sessionId}/diff`);
    if (!res.ok) {
      console.warn(`[PromptHandler] Diff response: ${res.status}`);
      return [];
    }

    const data = await res.json() as Array<{
      file: string;
      before: string;
      after: string;
      additions: number;
      deletions: number;
    }>;

    return data.map((entry) => {
      const status: DiffFile["status"] =
        !entry.before || entry.before === "" ? "added"
        : !entry.after || entry.after === "" ? "deleted"
        : "modified";

      const patch = createTwoFilesPatch(
        `a/${entry.file}`,
        `b/${entry.file}`,
        entry.before || "",
        entry.after || "",
        undefined,
        undefined,
        { context: 3 },
      );

      return { path: entry.file, status, diff: patch };
    });
  }

  private async createEphemeralSession(): Promise<string> {
    const res = await fetch(`${this.opencodeUrl}/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Failed to create ephemeral session: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { id: string };
    return data.id;
  }

  private async pollUntilIdle(sessionId: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.idleWaiters.delete(sessionId);
        reject(new Error(`Review timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.idleWaiters.set(sessionId, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private extractStatusType(props: Record<string, unknown>): string | undefined {
    const rawStatus = props.status;
    if (typeof rawStatus === "string") return rawStatus;
    if (rawStatus && typeof rawStatus === "object") return (rawStatus as SessionStatus).type;
    return undefined;
  }

  private appendEventTrace(entry: string): void {
    this.recentEventTrace.push(entry);
    if (this.recentEventTrace.length > 40) {
      this.recentEventTrace.shift();
    }
  }

  private computeNonOverlappingSuffix(base: string, incoming: string): string {
    if (!incoming) return "";
    if (!base) return incoming;
    if (incoming.startsWith(base)) return incoming.slice(base.length);
    if (base.endsWith(incoming)) return "";

    const maxOverlap = Math.min(base.length, incoming.length);
    for (let overlap = maxOverlap; overlap > 0; overlap--) {
      if (base.slice(-overlap) === incoming.slice(0, overlap)) {
        return incoming.slice(overlap);
      }
    }
    return incoming;
  }

  private sendAssistantResultSegment(messageId: string, rawSegment: string, source: string): void {
    const segment = rawSegment || "";
    const deduped = this.computeNonOverlappingSuffix(this.committedAssistantContent, segment);
    if (!deduped) {
      console.log(`[PromptHandler] Skipping duplicate assistant segment from ${source} (${segment.length} chars)`);
      return;
    }
    this.agentClient.sendResult(messageId, deduped);
    this.committedAssistantContent += deduped;
  }

  private extractAssistantTextFromMessageInfo(info: Record<string, unknown>): string | null {
    const parts = info.parts;
    if (Array.isArray(parts)) {
      let merged = "";
      for (const rawPart of parts) {
        if (!rawPart || typeof rawPart !== "object") continue;
        const part = rawPart as Record<string, unknown>;
        if (part.type !== "text") continue;
        const textSegment = typeof part.text === "string"
          ? part.text
          : typeof part.content === "string"
            ? part.content
            : "";
        if (textSegment) merged += textSegment;
      }
      if (merged.trim()) return merged;
    }

    if (typeof info.content === "string" && info.content.trim()) {
      return info.content;
    }

    return null;
  }

  private extractAssistantErrorFromMessageInfo(info: Record<string, unknown>): string | null {
    return openCodeErrorToMessage(info.error);
  }

  private extractTextFromParts(parts: unknown[]): string {
    let merged = "";
    for (const rawPart of parts) {
      if (!rawPart || typeof rawPart !== "object") continue;
      const part = rawPart as Record<string, unknown>;
      if (part.type !== "text") continue;
      const textSegment = typeof part.text === "string"
        ? part.text
        : typeof part.content === "string"
          ? part.content
          : "";
      if (textSegment) merged += textSegment;
    }
    return merged;
  }

  private async fetchAssistantMessageDetail(messageId: string): Promise<AssistantMessageRecovery> {
    if (!this.sessionId) return { text: null, error: null };
    try {
      const res = await fetch(`${this.opencodeUrl}/session/${this.sessionId}/message/${messageId}`);
      if (!res.ok) {
        console.warn(`[PromptHandler] Message detail fetch failed for ${messageId}: ${res.status}`);
        return { text: null, error: null };
      }

      const payload = await res.json() as {
        info?: OpenCodeMessageInfo;
        parts?: unknown[];
        content?: string;
      };
      const infoObj = (payload.info && typeof payload.info === "object")
        ? payload.info as Record<string, unknown>
        : payload as Record<string, unknown>;
      const role = typeof infoObj.role === "string" ? infoObj.role : undefined;
      const providerID = typeof infoObj.providerID === "string" ? infoObj.providerID : undefined;
      const modelID = typeof infoObj.modelID === "string" ? infoObj.modelID : undefined;
      const modelLabel = providerID && modelID ? `${providerID}/${modelID}` : undefined;
      const finish = typeof infoObj.finish === "string" ? infoObj.finish : undefined;
      const parts =
        Array.isArray(payload.parts) ? payload.parts
        : Array.isArray(infoObj.parts) ? infoObj.parts as unknown[]
        : [];
      const partTypes = parts
        .map((part) => (part && typeof part === "object" && "type" in part ? String((part as Record<string, unknown>).type) : "?"))
        .join(",");
      const partsText = this.extractTextFromParts(parts);
      const infoContent = typeof infoObj.content === "string"
        ? infoObj.content
        : typeof payload.content === "string"
          ? payload.content
          : "";
      const text = (partsText || infoContent || "").trim();
      const assistantError = this.extractAssistantErrorFromMessageInfo(infoObj);
      const errorName = isRecord(infoObj.error) && typeof infoObj.error.name === "string"
        ? infoObj.error.name
        : undefined;
      const tokenObj = isRecord(infoObj.tokens) ? infoObj.tokens : undefined;
      const outputTokens =
        tokenObj && typeof tokenObj.output === "number" && Number.isFinite(tokenObj.output)
          ? tokenObj.output
          : null;
      const derivedEmptyError =
        !assistantError && !text && role === "assistant"
          ? `Model ${modelLabel ?? "unknown"} returned an empty completion (finish=${finish ?? "none"}, outputTokens=${outputTokens ?? "unknown"}).`
          : null;

      console.log(
        `[PromptHandler] Message detail ${messageId}: role=${role || "unknown"} ` +
        `parts=[${partTypes}] partsText=${partsText.length} infoContent=${infoContent.length} text=${text.length} ` +
        `error=${assistantError ? "yes" : "no"}${errorName ? `(${errorName})` : ""} ` +
        `model=${modelLabel ?? "unknown"} finish=${finish ?? "none"} outputTokens=${outputTokens ?? "unknown"} ` +
        `infoKeys=[${Object.keys(infoObj).join(",")}]`
      );

      if (role !== "assistant") return { text: null, error: null };
      return {
        text: text ? text : null,
        error: assistantError ?? derivedEmptyError,
        modelLabel,
        finish,
        outputTokens,
      };
    } catch (err) {
      console.warn(`[PromptHandler] Message detail fetch error for ${messageId}:`, err);
      return { text: null, error: null };
    }
  }

  private async recoverAssistantOutcomeFromApi(): Promise<AssistantMessageRecovery | null> {
    if (!this.sessionId || this.activeAssistantMessageIds.size === 0) return null;
    const assistantIds = Array.from(this.activeAssistantMessageIds).reverse();

    for (const ocMessageId of assistantIds) {
      const result = await this.fetchAssistantMessageDetail(ocMessageId);
      if (result.text || result.error) return result;
    }
    return null;
  }

  private async recoverAssistantTextOrError(): Promise<{ text: string | null; error: string | null }> {
    const recovered = await this.recoverAssistantOutcomeFromApi();
    if (!recovered) {
      return { text: null, error: null };
    }
    return {
      text: recovered.text ? recovered.text.trim() : null,
      error: recovered.error || null,
    };
  }

  private async deleteSession(sessionId: string): Promise<void> {
    const res = await fetch(`${this.opencodeUrl}/session/${sessionId}`, {
      method: "DELETE",
    });
    console.log(`[PromptHandler] Delete ephemeral session ${sessionId}: ${res.status}`);
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

  // ─── Audio Transcription ─────────────────────────────────────────────

  private static AUDIO_EXTENSIONS: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/flac': 'flac',
  };

  private async transcribeAudioAttachments(
    attachments: PromptAttachment[],
  ): Promise<{ transcriptions: string[]; remaining: PromptAttachment[] }> {
    const fs = await import('fs/promises');
    const transcriptions: string[] = [];
    const remaining: PromptAttachment[] = [];

    for (const attachment of attachments) {
      if (!attachment.mime.startsWith('audio/')) {
        remaining.push(attachment);
        continue;
      }

      const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const ext = PromptHandler.AUDIO_EXTENSIONS[attachment.mime] || 'ogg';
      const srcPath = `/tmp/voice-${uid}.${ext}`;
      const wavPath = `/tmp/voice-${uid}.wav`;
      const outBase = `/tmp/voice-${uid}-out`;
      const txtPath = `${outBase}.txt`;

      try {
        // Decode base64 data URL → write to temp file
        const commaIdx = attachment.url.indexOf(',');
        if (commaIdx === -1) {
          console.warn('[PromptHandler] Invalid audio data URL, skipping');
          remaining.push(attachment);
          continue;
        }
        const b64 = attachment.url.slice(commaIdx + 1);
        const bytes = Buffer.from(b64, 'base64');
        await Bun.write(srcPath, bytes);
        console.log(`[PromptHandler] Wrote audio file: ${srcPath} (${bytes.length} bytes, ${attachment.mime})`);

        // Convert to WAV (16kHz mono) via ffmpeg — whisper-cli needs WAV input
        const needsConvert = ext !== 'wav';
        const whisperInput = needsConvert ? wavPath : srcPath;

        if (needsConvert) {
          const ffmpegProc = Bun.spawn([
            'ffmpeg', '-i', srcPath,
            '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
            '-y', wavPath,
          ], { stdout: 'pipe', stderr: 'pipe' });
          const ffmpegExit = await ffmpegProc.exited;
          if (ffmpegExit !== 0) {
            const stderr = await new Response(ffmpegProc.stderr).text();
            console.error(`[PromptHandler] ffmpeg conversion failed (exit ${ffmpegExit}): ${stderr.slice(-500)}`);
            remaining.push(attachment);
            continue;
          }
          console.log(`[PromptHandler] Converted ${ext} → WAV: ${wavPath}`);
        }

        // Run whisper-cli
        const whisperProc = Bun.spawn([
          'whisper-cli',
          '--model', '/models/whisper/ggml-base.en.bin',
          '--file', whisperInput,
          '--output-txt',
          '--output-file', outBase,
          '--no-timestamps',
        ], { stdout: 'pipe', stderr: 'pipe' });

        const exitCode = await whisperProc.exited;
        const stderr = await new Response(whisperProc.stderr).text();
        if (exitCode !== 0) {
          console.error(`[PromptHandler] whisper-cli failed (exit ${exitCode}): ${stderr.slice(-500)}`);
          remaining.push(attachment);
          continue;
        }

        // Read transcript
        if (!await Bun.file(txtPath).exists()) {
          console.error(`[PromptHandler] whisper-cli produced no output file at ${txtPath}. stderr: ${stderr.slice(-500)}`);
          remaining.push(attachment);
          continue;
        }

        const transcript = (await Bun.file(txtPath).text()).trim();
        if (transcript) {
          transcriptions.push(transcript);
          console.log(`[PromptHandler] Transcribed audio (${attachment.filename || 'voice'}): "${transcript.slice(0, 100)}..."`);
        } else {
          console.warn(`[PromptHandler] whisper-cli produced empty transcript`);
          remaining.push(attachment);
        }
      } catch (err) {
        console.error('[PromptHandler] Audio transcription error:', err);
        remaining.push(attachment);
      } finally {
        // Clean up all temp files
        for (const p of [srcPath, wavPath, txtPath]) {
          try { await fs.unlink(p); } catch {}
        }
      }
    }

    return { transcriptions, remaining };
  }

  private async sendPromptAsync(sessionId: string, content: string, model?: string, attachments?: PromptAttachment[], author?: PromptAuthor, channelType?: string, channelId?: string): Promise<void> {
    const url = `${this.opencodeUrl}/session/${sessionId}/prompt_async`;
    console.log(`[PromptHandler] POST ${url}${model ? ` (model: ${model})` : ''}${attachments?.length ? ` (attachments: ${attachments.length})` : ''}`);

    const promptParts: Array<Record<string, unknown>> = [];
    for (const attachment of attachments ?? []) {
      promptParts.push({
        type: "file",
        mime: attachment.mime,
        url: attachment.url,
        ...(attachment.filename ? { filename: attachment.filename } : {}),
      });
    }
    // Prefix content with channel context and user identity (agent sees this, users don't)
    let attributedContent = content;
    if (channelType && channelId) {
      attributedContent = `[via ${channelType} | chatId: ${channelId}] ${attributedContent}`;
    }
    if (author?.authorName || author?.authorEmail) {
      const name = author.authorName || 'Unknown';
      const email = author.authorEmail ? ` <${author.authorEmail}>` : '';
      const userId = author.authorId ? ` (userId: ${author.authorId})` : '';
      attributedContent = `[User: ${name}${email}${userId}] ${attributedContent}`;
    }
    if (attributedContent) {
      promptParts.push({ type: "text", text: attributedContent });
    }
    if (promptParts.length === 0) {
      throw new Error("Cannot send empty prompt: no text or attachments");
    }
    const body: Record<string, unknown> = {
      parts: promptParts,
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
      const error = new Error(`OpenCode prompt_async failed: ${res.status} — ${body}`);
      (error as { status?: number }).status = res.status;
      throw error;
    }
  }

  private isSessionGone(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const maybeStatus = (err as { status?: number }).status;
    if (maybeStatus === 404 || maybeStatus === 410) return true;
    const msg = err instanceof Error ? err.message : String(err);
    return /session.*(not found|missing|gone)/i.test(msg) || /404/.test(msg);
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
          const raw = JSON.parse(eventData) as unknown;
          const event = normalizeOpenCodeEvent(raw);
          if (!event) {
            if (eventCount < 10) {
              console.warn(`[PromptHandler] Ignoring malformed SSE event: ${eventData.slice(0, 150)}`);
            }
            continue;
          }
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

    // Check for ephemeral session events before filtering
    // Session ID can be at top level or nested inside part/info objects
    const part = props.part as Record<string, unknown> | undefined;
    const info = props.info as Record<string, unknown> | undefined;
    const eventSessionId = (
      props.sessionID ?? props.session_id ??
      part?.sessionID ?? info?.sessionID
    ) as string | undefined;
    if (eventSessionId && this.ephemeralContent.has(eventSessionId)) {
      const mappedChannel = this.ocSessionToChannel.get(eventSessionId);
      // Capture text deltas from ephemeral session SSE events
      if (event.type === "message.part.updated") {
        if (part?.type === "text") {
          const partMessageId = typeof part.messageID === "string" ? part.messageID : undefined;
          const partRole = partMessageId && mappedChannel ? mappedChannel.messageRoles.get(partMessageId) : undefined;
          const allowTextDeltaCapture = !mappedChannel || partRole === "assistant";
          if (!allowTextDeltaCapture) {
            // For normal workflow session prompts, ignore non-assistant deltas.
            // Assistant text is captured from message.updated snapshots below.
          } else {
          const delta = props.delta as string | undefined;
          if (delta) {
            const prev = this.ephemeralContent.get(eventSessionId) || "";
            this.ephemeralContent.set(eventSessionId, prev + delta);
          } else if (typeof part.text === "string" && part.text) {
            const prev = this.ephemeralContent.get(eventSessionId) || "";
            const suffix = this.computeNonOverlappingSuffix(prev, part.text);
            if (suffix) {
              this.ephemeralContent.set(eventSessionId, prev + suffix);
            }
          }
          }
        }
      }
      if (event.type === "message.updated") {
        if (mappedChannel) {
          const role = typeof info?.role === "string" ? info.role : undefined;
          const id = typeof info?.id === "string" ? info.id : undefined;
          if (id && role) {
            mappedChannel.messageRoles.set(id, role);
          }
        }
        if (info?.role === "assistant") {
          const snapshot = this.extractAssistantTextFromMessageInfo(info);
          if (snapshot) {
            this.ephemeralContent.set(eventSessionId, snapshot);
          }
        }
      }

      const isIdle =
        event.type === "session.idle" ||
        (event.type === "session.status" && this.extractStatusType(props) === "idle");
      if (isIdle) {
        const content = this.ephemeralContent.get(eventSessionId) || "";
        console.log(`[PromptHandler] Ephemeral session ${eventSessionId} became idle (captured ${content.length} chars)`);
        const resolve = this.idleWaiters.get(eventSessionId);
        if (resolve) {
          this.idleWaiters.delete(eventSessionId);
          resolve();
        }
      }

      // Auto-approve permissions for ephemeral sessions too
      if ((event.type === "permission.asked" || event.type === "permission.updated") && eventSessionId !== this.sessionId) {
        const permId = String(props.id ?? "");
        if (permId) {
          console.log(`[PromptHandler] Auto-approving permission for ephemeral session: ${permId}`);
          this.respondToPermissionOnSession(eventSessionId, permId, "always");
        }
      }

      // Don't process ephemeral session events through main handler
      if (eventSessionId !== this.sessionId) return;
    }

    // Route to the correct channel session via OC session ID
    let eventChannel: ChannelSession | undefined;
    if (eventSessionId) {
      eventChannel = this.ocSessionToChannel.get(eventSessionId);
      if (!eventChannel) {
        // Not one of our channel sessions — skip unless it's the legacy single session
        // (backward compat for channels created before per-channel routing)
        if (this.activeChannel?.opencodeSessionId === eventSessionId) {
          eventChannel = this.activeChannel;
        } else {
          return;
        }
      }
    } else {
      // No session ID in event — use the active channel
      eventChannel = this.activeChannel ?? undefined;
    }

    // Set activeChannel for the duration of event processing so delegate accessors work
    const prevChannel = this.activeChannel;
    if (eventChannel) this.activeChannel = eventChannel;

    const tracePart = props.part as Record<string, unknown> | undefined;
    const traceInfo = (props.info ?? props) as Record<string, unknown>;
    const traceMsgId =
      (tracePart?.messageID as string | undefined) ??
      (tracePart?.messageId as string | undefined) ??
      (traceInfo?.id as string | undefined);
    const traceRole = traceInfo?.role as string | undefined;
    const traceDelta = typeof props.delta === "string" ? props.delta.length : 0;
    const traceType = tracePart?.type ? String(tracePart.type) : undefined;
    this.appendEventTrace(`${event.type}${traceType ? `:${traceType}` : ""}${traceRole ? ` role=${traceRole}` : ""}${traceMsgId ? ` msg=${traceMsgId}` : ""}${traceDelta ? ` d=${traceDelta}` : ""}`);

    try {
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
        // Dedicated idle event — finalize response (even if no activity, to handle empty responses)
        console.log(`[PromptHandler] session.idle (channel: ${eventChannel?.channelKey ?? 'unknown'}, activeMessageId: ${this.activeMessageId ? 'yes' : 'no'}, hasActivity: ${this.hasActivity})`);
        if (this.activeMessageId && !this.retryPending && !this.awaitingAssistantForAttempt) {
          console.log(`[PromptHandler] Session idle, finalizing response`);
          this.finalizeResponse();
        } else if (this.retryPending || this.awaitingAssistantForAttempt) {
          console.log(
            `[PromptHandler] session.idle ignored (retryPending=${this.retryPending}, awaitingAssistant=${this.awaitingAssistantForAttempt})`
          );
        }
        if (!this.idleNotified) {
          this.agentClient.sendAgentStatus("idle");
          this.idleNotified = true;
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

      case "question.asked": {
        this.handleQuestionAsked(props);
        break;
      }

      case "question.replied":
      case "question.rejected": {
        const requestID = typeof props.requestID === "string" ? props.requestID : "";
        if (requestID) {
          this.clearQuestionRequest(requestID);
        }
        break;
      }

      case "session.error": {
        // OpenCode session error — extract error message
        const rawError = props.error ?? props.message ?? props.description;
        const errorMsg = openCodeErrorToMessage(rawError) ?? "Unknown agent error";
        console.error(`[PromptHandler] session.error: ${errorMsg}`);
        // Also log the raw structure for debugging
        console.error(`[PromptHandler] session.error raw:`, JSON.stringify(props));

        // Check if this is a retriable provider error and we have model preferences
        if (this.activeMessageId && !this.hasActivity && isRetriableProviderError(errorMsg)) {
          // Attempt failover — only if we haven't started streaming content yet
          this.attemptModelFailover(errorMsg).then((didFailover) => {
            if (!didFailover) {
              // No more models — propagate original error
              this.lastError = errorMsg;
              this.hasActivity = true;
            }
          }).catch(() => {
            this.lastError = errorMsg;
            this.hasActivity = true;
          });
        } else {
          this.lastError = errorMsg;
          this.hasActivity = true;
        }
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
    } finally {
      // Restore the previous active channel
      this.activeChannel = prevChannel;
    }
  }

  private handlePartUpdated(props: Record<string, unknown>): void {
    if (!this.activeMessageId) return;

    // The part can be a tool part or a text part
    const part = props.part as Record<string, unknown> | undefined;
    if (!part) return;

    const messageIdRaw =
      part.messageID ??
      part.messageId ??
      props.messageID ??
      props.messageId;
    const partMessageId = messageIdRaw ? String(messageIdRaw) : undefined;
    const partRole = partMessageId ? this.messageRoles.get(partMessageId) : undefined;
    const partType = String(part.type ?? "");

    // Guard rail: ignore non-assistant parts once role is known.
    if (partRole && partRole !== "assistant") {
      return;
    }

    // If this text part belongs to a known assistant message from a prior turn, ignore it.
    if (partType === "text" && partMessageId && this.activeAssistantMessageIds.size > 0) {
      if (!this.activeAssistantMessageIds.has(partMessageId) && partRole !== undefined) {
        return;
      }
    }

    const delta = props.delta as string | undefined;

    if (partType === "text") {
      const partIdRaw = part.id ?? part.messageID ?? "text";
      const partId = String(partIdRaw);
      const messageSnapshotKey = partMessageId ?? this.activeMessageId ?? "active";
      const partText = typeof part.text === "string"
        ? part.text
        : typeof part.content === "string"
          ? String(part.content)
        : typeof props.text === "string"
          ? String(props.text)
          : undefined;

      // Treat full part snapshots as canonical when available.
      // Some providers/reconnect paths may replay events with a repeated delta.
      // Using snapshots first keeps us aligned with OpenCode's replace-by-part-id model.
      let chunk = "";
      if (typeof partText === "string") {
        const prevByPart = this.textPartSnapshots.get(partId) ?? "";
        const prevByMessage = this.messageTextSnapshots.get(messageSnapshotKey) ?? "";
        const prevGlobal = `${this.committedAssistantContent}${this.streamedContent}`;
        const candidates = [prevByPart, prevByMessage, prevGlobal].filter(Boolean);
        const prefixMatch = candidates
          .filter((candidate) => partText.startsWith(candidate))
          .sort((a, b) => b.length - a.length)[0];
        const prev = prefixMatch ?? "";
        if (partText.startsWith(prev)) {
          chunk = partText.slice(prev.length);
        } else if (
          partText === prev ||
          prev.startsWith(partText) ||
          this.committedAssistantContent.endsWith(partText)
        ) {
          // Duplicate or out-of-order stale snapshot.
          chunk = "";
        } else if (this.streamedContent.endsWith(partText)) {
          // Exact replay of the same full snapshot.
          chunk = "";
        } else {
          // Snapshot changed without sharing a clean prefix (rewrite/out-of-order).
          // Emit only the non-overlapping suffix so replayed snapshots don't duplicate text.
          chunk = this.computeNonOverlappingSuffix(prevGlobal, partText);
        }
        this.textPartSnapshots.set(partId, partText);
        this.messageTextSnapshots.set(messageSnapshotKey, partText);
      } else if (delta) {
        // Snapshot missing: fall back to delta mode.
        chunk = delta;
      }

      if (chunk) {
        if (this.streamedContent === "") {
          this.agentClient.sendAgentStatus("streaming");
        }
        this.hasActivity = true;
        // Text resuming after tool calls — streamedContent was already committed
        // before the tool started, so just reset the flag and keep accumulating.
        if (this.hadToolSinceLastText) {
          this.hadToolSinceLastText = false;
        }
        this.streamedContent += chunk;
        this.lastChunkTime = Date.now();
        this.agentClient.sendStreamChunk(this.activeMessageId, chunk);
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
    const prev = this.toolStates.get(callID);
    const prevStatus = prev?.status;
    const currentStatus = state.status;

    // Only act on state transitions
    if (currentStatus === prevStatus) return;

    // wait_for_event: treat as an immediate yield — force completion + idle
    if (toolName === "wait_for_event" && (currentStatus === "pending" || currentStatus === "running") && !this.waitForEventForced) {
      this.waitForEventForced = true;
      console.log(`[PromptHandler] wait_for_event observed (${currentStatus}) — forcing completion + idle`);
      this.toolStates.set(callID, { status: "completed", toolName });
      this.agentClient.sendToolCall(
        callID,
        toolName,
        "completed",
        state.input ?? null,
        null,
      );
      this.finalizeResponse(true);
      this.agentClient.sendAgentStatus("idle");
      this.idleNotified = true;
      if (this.sessionId) {
        fetch(`${this.opencodeUrl}/session/${this.sessionId}/abort`, { method: "POST" })
          .catch((err) => console.error("[PromptHandler] Error aborting after wait_for_event:", err));
      }
      return;
    }

    console.log(`[PromptHandler] Tool "${toolName}" [${callID}] ${prevStatus ?? "new"} → ${currentStatus}`);
    this.toolStates.set(callID, { status: currentStatus, toolName });

    this.hasActivity = true;
    this.hadToolSinceLastText = true;
    this.lastChunkTime = Date.now();
    this.resetResponseTimeout();

    // When a NEW tool appears and we have accumulated text, commit the text
    // as a stored assistant message so it persists across page reloads.
    // The client merges consecutive assistant text messages back together.
    if (!prevStatus && this.streamedContent.trim() && this.activeMessageId) {
      console.log(`[PromptHandler] Committing text segment (${this.streamedContent.length} chars) before tool "${toolName}"`);
      this.sendAssistantResultSegment(this.activeMessageId, this.streamedContent, "tool-boundary");
      this.streamedContent = "";
    }

    // Send tool call on every state transition with callID + status
    if (currentStatus === "pending" || currentStatus === "running") {
      if (toolName === "question") {
        // Question tools wait on user input; keep UI interactive instead of "thinking".
        this.agentClient.sendAgentStatus("idle");
        this.idleNotified = true;
      } else {
        this.agentClient.sendAgentStatus("tool_calling", toolName);
      }
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

      // wait_for_event: forcibly end the turn so the agent actually stops
      if (toolName === "wait_for_event") {
        console.log(`[PromptHandler] wait_for_event completed — aborting OpenCode and finalizing turn`);
        this.finalizeResponse(true);
        // Ensure DO clears runnerBusy even if no other events arrive
        this.agentClient.sendAgentStatus("idle");
        this.idleNotified = true;
        // Abort OpenCode generation so it fully yields
        if (this.sessionId) {
          fetch(`${this.opencodeUrl}/session/${this.sessionId}/abort`, { method: "POST" })
            .catch((err) => console.error("[PromptHandler] Error aborting after wait_for_event:", err));
        }
      }

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
    const assistantError = role === "assistant" ? this.extractAssistantErrorFromMessageInfo(info) : null;

    console.log(`[PromptHandler] message.updated: role=${role} (active: ${this.activeMessageId ? 'yes' : 'no'}, content: ${this.streamedContent.length} chars, activity: ${this.hasActivity})`);

    // Capture OpenCode message ID mapping for revert support
    const ocMessageId = info.id as string | undefined;
    if (ocMessageId && role) {
      this.messageRoles.set(ocMessageId, role);
    }
    if (ocMessageId && role === "assistant") {
      this.activeAssistantMessageIds.add(ocMessageId);
      this.awaitingAssistantForAttempt = false;
    }
    if (ocMessageId && this.activeMessageId && role === "assistant") {
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
      const snapshotText = this.extractAssistantTextFromMessageInfo(info);
      if (snapshotText) {
        this.latestAssistantTextSnapshot = snapshotText;
      }
      if (assistantError) {
        this.lastError = assistantError;
        this.appendEventTrace(`assistant.error:${assistantError.slice(0, 120)}`);
      }
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

    if (statusType === "idle") {
      if (this.activeMessageId && !this.retryPending && !this.awaitingAssistantForAttempt) {
        console.log(`[PromptHandler] Session idle, finalizing response`);
        this.finalizeResponse();
      } else if (this.retryPending || this.awaitingAssistantForAttempt) {
        console.log(
          `[PromptHandler] session.status=idle ignored (retryPending=${this.retryPending}, awaitingAssistant=${this.awaitingAssistantForAttempt})`
        );
      }
      if (!this.idleNotified) {
        this.agentClient.sendAgentStatus("idle");
        this.idleNotified = true;
      }
    } else if (statusType === "busy") {
      if (this.retryPending) {
        this.retryPending = false;
      }
      this.idleNotified = false;
    }
  }

  private async finalizeResponse(force = false): Promise<void> {
    if (!this.activeMessageId || this.failoverInProgress) {
      return;
    }
    if (this.finalizeInFlight) {
      return;
    }
    this.finalizeInFlight = true;

    try {

      // Clear any pending timeout
      this.clearResponseTimeout();

      const messageId = this.activeMessageId;
      let content = this.streamedContent || this.latestAssistantTextSnapshot;

      // Send result, error, or fallback depending on what happened
      if (content) {
        console.log(`[PromptHandler] Sending result for ${messageId} (${content.length} chars): "${content.slice(0, 100)}..."`);
        this.sendAssistantResultSegment(messageId, content, "finalize");
      } else if (this.lastError) {
        if (isRetriableProviderError(this.lastError)) {
          console.log(`[PromptHandler] Retriable assistant error for ${messageId} — attempting model failover`);
          this.failoverInProgress = true;
          this.retryPending = true;
          let didFailover = false;
          try {
            didFailover = await this.attemptModelFailover(this.lastError);
            if (didFailover) {
              console.log(`[PromptHandler] Failover initiated for ${messageId} after assistant error — waiting for retry`);
              return;
            }
          } finally {
            this.failoverInProgress = false;
            if (!didFailover) {
              this.retryPending = false;
            }
          }
        }
        console.log(`[PromptHandler] Sending error for ${messageId}: ${this.lastError}`);
        this.agentClient.sendError(messageId, this.lastError);
      } else if (this.toolStates.size > 0) {
        // Tools ran but no text was produced — this is normal for tool-only turns
        console.log(`[PromptHandler] Tools-only response for ${messageId} (${this.toolStates.size} tools ran)`);
      } else {
        const recovered = await this.recoverAssistantTextOrError();
        if (recovered.error) {
          this.lastError = recovered.error;
        }
        if (recovered.text) {
          content = recovered.text;
          console.log(
            `[PromptHandler] Recovered assistant text for ${messageId} from message API (${recovered.text.length} chars)`
          );
          this.sendAssistantResultSegment(messageId, recovered.text, "recovery");
        } else if (this.lastError) {
          if (isRetriableProviderError(this.lastError)) {
            console.log(`[PromptHandler] Retriable recovered error for ${messageId} — attempting model failover`);
            this.failoverInProgress = true;
            this.retryPending = true;
            let didFailover = false;
            try {
              didFailover = await this.attemptModelFailover(this.lastError);
              if (didFailover) {
                console.log(`[PromptHandler] Failover initiated for ${messageId} after recovery error — waiting for retry`);
                return;
              }
            } finally {
              this.failoverInProgress = false;
              if (!didFailover) {
                this.retryPending = false;
              }
            }
          }
          console.log(`[PromptHandler] Sending recovered error for ${messageId}: ${this.lastError}`);
          this.agentClient.sendError(messageId, this.lastError);
        } else {
          // Model produced nothing — try failover to next model before giving up
          console.warn(
            `[PromptHandler] Empty-response diagnostics for ${messageId}: ` +
            `snapshot=${this.latestAssistantTextSnapshot.length} ` +
            `assistantMsgs=${this.activeAssistantMessageIds.size} ` +
            `roles=${this.messageRoles.size} ` +
            `trace=${this.recentEventTrace.join(" | ")}`
          );
          console.log(`[PromptHandler] Empty response for ${messageId} — attempting model failover`);
          this.failoverInProgress = true;
          this.retryPending = true;
          let didFailover = false;
          try {
            didFailover = await this.attemptModelFailover("Model returned an empty response");
            if (didFailover) {
              console.log(`[PromptHandler] Failover initiated for ${messageId} — waiting for retry`);
              return; // Don't complete — retry in progress with next model
            }
          } finally {
            this.failoverInProgress = false;
            if (!didFailover) {
              this.retryPending = false;
            }
          }
          // No more models to try — send error
          console.log(`[PromptHandler] No failover available for ${messageId} — sending empty response error`);
          this.agentClient.sendError(messageId, "The model returned an empty response. Try again or switch to a different model.");
        }
      }

      // Flush any tools still in non-terminal state as "completed".
      // This handles cases where the completed event was missed or arrived out-of-order.
      for (const [callID, { status, toolName }] of this.toolStates) {
        if (status === "pending" || status === "running") {
          console.log(`[PromptHandler] Flushing stuck tool "${toolName}" [${callID}] as completed (was: ${status})`);
          this.agentClient.sendToolCall(callID, toolName, "completed", null, null);
        }
      }

      console.log(`[PromptHandler] Sending complete`);
      this.agentClient.sendComplete();

      // Notify client that agent is idle
      this.agentClient.sendAgentStatus("idle");

      // Report files changed after each turn
      this.reportFilesChanged().catch((err) =>
        console.error("[PromptHandler] Error reporting files changed:", err)
      );

      this.streamedContent = "";
      this.committedAssistantContent = "";
      this.hasActivity = false;
      this.hadToolSinceLastText = false;
      this.activeMessageId = null;
      this.lastChunkTime = 0;
      this.lastError = null;
      this.toolStates.clear();
      this.textPartSnapshots.clear();
      this.messageTextSnapshots.clear();
      this.messageRoles.clear();
      this.activeAssistantMessageIds.clear();
      this.latestAssistantTextSnapshot = "";
      this.recentEventTrace = [];
      this.awaitingAssistantForAttempt = false;
      // Clear failover state
      this.currentModelPreferences = undefined;
      this.currentModelIndex = 0;
      this.pendingRetryContent = null;
      this.pendingRetryAttachments = [];
      this.pendingRetryAuthor = undefined;
      this.retryPending = false;
      this.awaitingAssistantForAttempt = false;
      console.log(`[PromptHandler] Response finalized`);
    } finally {
      this.finalizeInFlight = false;
    }
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

  private async reportFilesChanged(): Promise<void> {
    if (!this.sessionId) return;
    try {
      const res = await fetch(`${this.opencodeUrl}/session/${this.sessionId}/diff`);
      if (!res.ok) return;

      const data = await res.json() as Array<{
        file: string;
        before: string;
        after: string;
        additions: number;
        deletions: number;
      }>;

      if (data.length === 0) return;

      const files = data.map((entry) => ({
        path: entry.file,
        status: !entry.before || entry.before === "" ? "added"
          : !entry.after || entry.after === "" ? "deleted"
          : "modified",
        additions: entry.additions,
        deletions: entry.deletions,
      }));

      console.log(`[PromptHandler] Files changed: ${files.length} files`);
      this.agentClient.sendFilesChanged(files);
    } catch (err) {
      console.error("[PromptHandler] Error fetching files changed:", err);
    }
  }
}
