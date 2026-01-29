// ─── Runner ↔ DO WebSocket Protocol ────────────────────────────────────────

/** Messages sent from DO to Runner */
export type DOToRunnerMessage =
  | { type: "prompt"; messageId: string; content: string }
  | { type: "answer"; questionId: string; answer: string | boolean }
  | { type: "stop" };

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
  | { type: "create-pr"; branch: string; title: string; body?: string; base?: string };

// ─── CLI Config ────────────────────────────────────────────────────────────

export interface RunnerConfig {
  opencodeUrl: string;
  doUrl: string;
  runnerToken: string;
  sessionId: string;
}
