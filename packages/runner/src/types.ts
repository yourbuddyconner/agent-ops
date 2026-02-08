// ─── Runner ↔ DO WebSocket Protocol ────────────────────────────────────────

/** Messages sent from DO to Runner */
export interface PromptAttachment {
  type: "file";
  mime: string;
  url: string;
  filename?: string;
}

export interface WorkflowRunResultStep {
  stepId: string;
  status: string;
  attempt?: number;
  startedAt?: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
}

export interface WorkflowRunResultEnvelope {
  ok: boolean;
  status: "ok" | "needs_approval" | "cancelled" | "failed";
  executionId: string;
  output?: Record<string, unknown>;
  steps?: WorkflowRunResultStep[];
  requiresApproval?: null | {
    stepId: string;
    prompt: string;
    items: unknown[];
    resumeToken: string;
  };
  error?: string | null;
}

export type DOToRunnerMessage =
  | { type: "prompt"; messageId: string; content: string; model?: string;
      attachments?: PromptAttachment[];
      modelPreferences?: string[];
      authorId?: string; authorEmail?: string; authorName?: string;
      gitName?: string; gitEmail?: string }
  | { type: "answer"; questionId: string; answer: string | boolean }
  | { type: "stop" }
  | { type: "abort" }
  | { type: "revert"; messageId: string }
  | { type: "diff"; requestId: string }
  | { type: "review"; requestId: string }
  | { type: "pong" }
  | { type: "spawn-child-result"; requestId: string; childSessionId?: string; error?: string }
  | { type: "session-message-result"; requestId: string; success?: boolean; error?: string }
  | { type: "session-messages-result"; requestId: string; messages?: Array<{ role: string; content: string; createdAt: string }>; error?: string }
  | { type: "create-pr-result"; requestId: string; number?: number; url?: string; title?: string; state?: string; error?: string }
  | { type: "update-pr-result"; requestId: string; number?: number; url?: string; title?: string; state?: string; error?: string }
  | { type: "list-pull-requests-result"; requestId: string; pulls?: unknown[]; error?: string }
  | { type: "inspect-pull-request-result"; requestId: string; data?: unknown; error?: string }
  | { type: "terminate-child-result"; requestId: string; success?: boolean; error?: string }
  | { type: "memory-read-result"; requestId: string; memories?: unknown[]; error?: string }
  | { type: "memory-write-result"; requestId: string; memory?: unknown; success?: boolean; error?: string }
  | { type: "memory-delete-result"; requestId: string; success?: boolean; error?: string }
  | { type: "list-repos-result"; requestId: string; repos?: unknown[]; error?: string }
  | { type: "list-personas-result"; requestId: string; personas?: unknown[]; error?: string }
  | { type: "get-session-status-result"; requestId: string; sessionStatus?: unknown; error?: string }
  | { type: "list-child-sessions-result"; requestId: string; children?: unknown[]; error?: string }
  | { type: "forward-messages-result"; requestId: string; count?: number; sourceSessionId?: string; error?: string }
  | { type: "read-repo-file-result"; requestId: string; content?: string; encoding?: string; truncated?: boolean; path?: string; repo?: string; ref?: string; error?: string }
  | { type: "workflow-list-result"; requestId: string; workflows?: unknown[]; error?: string }
  | { type: "workflow-sync-result"; requestId: string; success?: boolean; workflow?: unknown; error?: string }
  | { type: "workflow-run-result"; requestId: string; execution?: unknown; error?: string }
  | { type: "workflow-executions-result"; requestId: string; executions?: unknown[]; error?: string }
  | {
      type: "workflow-execute";
      executionId: string;
      payload: {
        kind: "run" | "resume";
        executionId: string;
        workflowHash?: string;
        resumeToken?: string;
        decision?: "approve" | "deny";
        payload: Record<string, unknown>;
      };
    }
  | { type: "tunnel-delete"; name: string; actorId?: string; actorName?: string; actorEmail?: string };

/** Tool call status values */
export type ToolCallStatus = "pending" | "running" | "completed" | "error";

/** Agent status values */
export type AgentStatus = "idle" | "thinking" | "tool_calling" | "streaming" | "error";

/** Messages sent from Runner to DO */
export type RunnerToDOMessage =
  | { type: "stream"; messageId: string; content: string }
  | { type: "result"; messageId: string; content: string }
  | { type: "tool"; callID: string; toolName: string; status: ToolCallStatus; args: unknown; result: unknown; content?: string }
  | { type: "question"; questionId: string; text: string; options?: string[] }
  | { type: "screenshot"; data: string; description: string }
  | { type: "error"; messageId: string; error: string }
  | { type: "complete" }
  | { type: "agentStatus"; status: AgentStatus; detail?: string }
  | { type: "create-pr"; requestId: string; branch: string; title: string; body?: string; base?: string }
  | { type: "update-pr"; requestId: string; prNumber: number; title?: string; body?: string; state?: string; labels?: string[] }
  | { type: "list-pull-requests"; requestId: string; owner?: string; repo?: string; state?: string; limit?: number }
  | { type: "inspect-pull-request"; requestId: string; prNumber: number; owner?: string; repo?: string; filesLimit?: number; commentsLimit?: number }
  | { type: "git-state"; branch?: string; baseBranch?: string; commitCount?: number }
  | { type: "models"; models: AvailableModels }
  | { type: "aborted" }
  | { type: "reverted"; messageIds: string[] }
  | { type: "diff"; requestId: string; data: { files: DiffFile[] } }
  | { type: "files-changed"; files: Array<{ path: string; status: string; additions?: number; deletions?: number }> }
  | { type: "spawn-child"; requestId: string; task: string; workspace: string; repoUrl?: string; branch?: string; ref?: string; title?: string; sourceType?: string; sourcePrNumber?: number; sourceIssueNumber?: number; sourceRepoFullName?: string; model?: string }
  | { type: "session-message"; requestId: string; targetSessionId: string; content: string; interrupt?: boolean }
  | { type: "session-messages"; requestId: string; targetSessionId: string; limit?: number; after?: string }
  | { type: "terminate-child"; requestId: string; childSessionId: string }
  | { type: "self-terminate" }
  | { type: "review-result"; requestId: string; data?: ReviewResultData; diffFiles?: DiffFile[]; error?: string }
  | { type: "ping" }
  | { type: "memory-read"; requestId: string; category?: string; query?: string; limit?: number }
  | { type: "memory-write"; requestId: string; content: string; category: string }
  | { type: "memory-delete"; requestId: string; memoryId: string }
  | { type: "list-repos"; requestId: string; source?: string }
  | { type: "list-personas"; requestId: string }
  | { type: "get-session-status"; requestId: string; targetSessionId: string }
  | { type: "list-child-sessions"; requestId: string }
  | { type: "forward-messages"; requestId: string; targetSessionId: string; limit?: number; after?: string }
  | { type: "read-repo-file"; requestId: string; owner?: string; repo?: string; repoUrl?: string; path: string; ref?: string }
  | { type: "workflow-list"; requestId: string }
  | { type: "workflow-sync"; requestId: string; id?: string; slug?: string; name: string; description?: string; version?: string; data: Record<string, unknown> }
  | { type: "workflow-run"; requestId: string; workflowId: string; variables?: Record<string, unknown> }
  | { type: "workflow-executions"; requestId: string; workflowId?: string; limit?: number }
  | { type: "workflow-execution-result"; executionId: string; envelope: WorkflowRunResultEnvelope }
  | { type: "model-switched"; messageId: string; fromModel: string; toModel: string; reason: string }
  | { type: "tunnels"; tunnels: Array<{ name: string; port: number; protocol?: string; path: string }> };

/** Structured review result data */
export interface ReviewFinding {
  id: string;
  file: string;
  lineStart: number;
  lineEnd: number;
  severity: "critical" | "warning" | "suggestion" | "nitpick";
  category: string;
  title: string;
  description: string;
  suggestedFix?: string;
}

export interface ReviewFileSummary {
  path: string;
  summary: string;
  reviewOrder: number;
  findings: ReviewFinding[];
  linesAdded: number;
  linesDeleted: number;
}

export interface ReviewResultData {
  files: ReviewFileSummary[];
  overallSummary: string;
  stats: { critical: number; warning: number; suggestion: number; nitpick: number };
}

/** Model discovery types */
export interface ProviderModels {
  provider: string;
  models: { id: string; name: string }[];
}

export type AvailableModels = ProviderModels[];

/** Diff file entry returned by OpenCode diff API */
export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted";
  diff?: string;
}

// ─── CLI Config ────────────────────────────────────────────────────────────

export interface RunnerConfig {
  opencodeUrl: string;
  doUrl: string;
  runnerToken: string;
  sessionId: string;
}
