// ─── Runner ↔ DO WebSocket Protocol ────────────────────────────────────────

/** Messages sent from DO to Runner */
export type DOToRunnerMessage =
  | { type: "prompt"; messageId: string; content: string }
  | { type: "answer"; questionId: string; answer: string | boolean }
  | { type: "stop" };

/** Messages sent from Runner to DO */
export type RunnerToDOMessage =
  | { type: "stream"; messageId: string; content: string }
  | { type: "result"; messageId: string; content: string }
  | { type: "tool"; toolName: string; args: unknown; result: unknown; content?: string }
  | { type: "question"; questionId: string; text: string; options?: string[] }
  | { type: "screenshot"; data: string; description: string }
  | { type: "error"; messageId: string; error: string }
  | { type: "complete" };

// ─── CLI Config ────────────────────────────────────────────────────────────

export interface RunnerConfig {
  opencodeUrl: string;
  doUrl: string;
  runnerToken: string;
  sessionId: string;
}
