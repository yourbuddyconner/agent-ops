export interface TextPart {
  type: 'text';
  text: string;
  /** True while the DO is still receiving stream deltas for this part */
  streaming?: boolean;
}

export interface ToolCallPart {
  type: 'tool-call';
  callId: string;
  toolName: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  args?: unknown;
  result?: unknown;
  error?: string;
}

export interface FinishPart {
  type: 'finish';
  reason: 'end_turn' | 'error' | 'canceled';
}

export interface ErrorPart {
  type: 'error';
  message: string;
}

export type MessagePart = TextPart | ToolCallPart | FinishPart | ErrorPart;
