// ─── Runner ↔ DO WebSocket Protocol ────────────────────────────────────────

/** Messages sent from DO to Runner */
export type DOToRunnerMessage =
  | { type: "prompt"; messageId: string; content: string; model?: string }
  | { type: "answer"; questionId: string; answer: string | boolean }
  | { type: "stop" }
  | { type: "abort" }
  | { type: "revert"; messageId: string }
  | { type: "diff"; requestId: string }
  | { type: "pong" }
  | { type: "spawn-child-result"; requestId: string; childSessionId?: string; error?: string }
  | { type: "session-message-result"; requestId: string; success?: boolean; error?: string }
  | { type: "session-messages-result"; requestId: string; messages?: Array<{ role: string; content: string; createdAt: string }>; error?: string }
  | { type: "create-pr-result"; requestId: string; number?: number; url?: string; title?: string; state?: string; error?: string }
  | { type: "update-pr-result"; requestId: string; number?: number; url?: string; title?: string; state?: string; error?: string }
  | { type: "terminate-child-result"; requestId: string; success?: boolean; error?: string };

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
  | { type: "git-state"; branch?: string; baseBranch?: string; commitCount?: number }
  | { type: "models"; models: AvailableModels }
  | { type: "aborted" }
  | { type: "reverted"; messageIds: string[] }
  | { type: "diff"; requestId: string; data: { files: DiffFile[] } }
  | { type: "files-changed"; files: Array<{ path: string; status: string; additions?: number; deletions?: number }> }
  | { type: "spawn-child"; requestId: string; task: string; workspace: string; repoUrl?: string; branch?: string; title?: string; sourceType?: string; sourcePrNumber?: number; sourceIssueNumber?: number; sourceRepoFullName?: string }
  | { type: "session-message"; requestId: string; targetSessionId: string; content: string }
  | { type: "session-messages"; requestId: string; targetSessionId: string; limit?: number; after?: string }
  | { type: "terminate-child"; requestId: string; childSessionId: string }
  | { type: "self-terminate" }
  | { type: "ping" };

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
