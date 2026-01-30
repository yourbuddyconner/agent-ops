// ─── Runner ↔ DO WebSocket Protocol ────────────────────────────────────────

/** Messages sent from DO to Runner */
export type DOToRunnerMessage =
  | { type: "prompt"; messageId: string; content: string; model?: string }
  | { type: "answer"; questionId: string; answer: string | boolean }
  | { type: "stop" }
  | { type: "abort" }
  | { type: "revert"; messageId: string }
  | { type: "diff"; requestId: string };

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
  | { type: "create-pr"; branch: string; title: string; body?: string; base?: string }
  | { type: "models"; models: AvailableModels }
  | { type: "aborted" }
  | { type: "reverted"; messageIds: string[] }
  | { type: "diff"; requestId: string; data: { files: DiffFile[] } };

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
