import type { Message } from '@/api/types';
import { MessageItem } from './message-item';
import { StreamingMessage } from './streaming-message';
import { ThinkingIndicator } from './thinking-indicator';
import { MarkdownContent } from './markdown';

type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  isAgentThinking?: boolean;
  agentStatus?: AgentStatus;
  agentStatusDetail?: string;
  onRevert?: (messageId: string) => void;
}

/**
 * Group messages into "turns" for rendering.
 *
 * An assistant turn = all consecutive tool + assistant messages between
 * user/system messages. This ensures tools and text are rendered together
 * in a single visual block, maintaining the order they were received.
 */
interface MessageTurn {
  type: 'standalone' | 'assistant-turn';
  messages: Message[];
}

function groupIntoTurns(messages: Message[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let currentTurn: Message[] = [];

  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'system') {
      // Flush any pending assistant turn
      if (currentTurn.length > 0) {
        turns.push({ type: 'assistant-turn', messages: currentTurn });
        currentTurn = [];
      }
      turns.push({ type: 'standalone', messages: [msg] });
    } else {
      // tool or assistant — part of the current turn
      currentTurn.push(msg);
    }
  }

  // Flush remaining
  if (currentTurn.length > 0) {
    turns.push({ type: 'assistant-turn', messages: currentTurn });
  }

  return turns;
}

export function MessageList({ messages, streamingContent, isAgentThinking, agentStatus, agentStatusDetail, onRevert }: MessageListProps) {

  if (messages.length === 0 && !streamingContent) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-surface-2 dark:bg-surface-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 dark:text-neutral-500">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
            Start a conversation by sending a message.
          </p>
        </div>
      </div>
    );
  }

  const turns = groupIntoTurns(messages);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
        {turns.map((turn) => {
          if (turn.type === 'standalone') {
            const msg = turn.messages[0];
            return <MessageItem key={msg.id} message={msg} onRevert={onRevert} />;
          }

          // Assistant turn: render all tool + assistant messages in order within one block
          return (
            <AssistantTurn
              key={turn.messages[0].id}
              messages={turn.messages}
            />
          );
        })}
        {streamingContent && <StreamingMessage content={streamingContent} />}
        {isAgentThinking && !streamingContent && <ThinkingIndicator status={agentStatus} detail={agentStatusDetail} />}
      </div>
    </div>
  );
}

/**
 * Merge consecutive assistant text messages into single content blocks.
 * Tool messages stay as-is. This prevents fragmented text rendering
 * (e.g. "Looks" in one block and "like beans isn't..." in the next).
 */
type TurnSegment =
  | { kind: 'text'; content: string; id: string }
  | { kind: 'tool'; message: Message };

function mergeAssistantSegments(messages: Message[]): TurnSegment[] {
  const segments: TurnSegment[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      segments.push({ kind: 'tool', message: msg });
    } else if (msg.content) {
      const last = segments[segments.length - 1];
      if (last && last.kind === 'text') {
        // Accumulate consecutive text into one segment (no separator — they're often mid-sentence)
        last.content += msg.content;
      } else {
        segments.push({ kind: 'text', content: msg.content, id: msg.id });
      }
    }
  }

  return segments;
}

/** Renders an assistant turn: interleaved text segments and tool calls in one visual block. */
function AssistantTurn({ messages }: { messages: Message[] }) {
  const firstMessage = messages[0];
  const segments = mergeAssistantSegments(messages);

  return (
    <div className="flex gap-3 bg-surface-1 px-4 py-3 dark:bg-surface-1">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent/10 font-mono text-[10px] font-semibold text-accent">
        A
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            Assistant
          </span>
          <span className="font-mono text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
            {formatTime(firstMessage.createdAt)}
          </span>
        </div>

        <div className="space-y-2">
          {segments.map((seg) =>
            seg.kind === 'tool' ? (
              <InlineToolCard key={seg.message.id} message={seg.message} />
            ) : (
              <MarkdownContent key={seg.id} content={seg.content} />
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** Inline tool card for rendering within an assistant turn. */
function InlineToolCard({ message }: { message: Message }) {
  const toolData = getToolCallFromParts(message.parts);

  if (!toolData) {
    // Fallback: render content as text
    return <MarkdownContent content={message.content} />;
  }

  const isActive = toolData.status === 'pending' || toolData.status === 'running';
  const isDone = toolData.status === 'completed';
  const isError = toolData.status === 'error';

  const resultStr = (() => {
    if (toolData.result === null || toolData.result === undefined) return null;
    const s = typeof toolData.result === 'string' ? toolData.result : JSON.stringify(toolData.result, null, 2);
    if (s.length > 500) return s.slice(0, 500) + '\n... (truncated)';
    return s;
  })();

  return (
    <div className="rounded border border-neutral-200 bg-surface-0 p-2 dark:border-neutral-700 dark:bg-surface-0">
      <div className="flex items-center gap-2">
        {isActive && (
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
        )}
        {isDone && (
          <svg className="h-3 w-3 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
        {isError && (
          <svg className="h-3 w-3 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        )}

        <span className="font-mono text-[11px] font-medium text-neutral-900 dark:text-neutral-100">
          {toolData.toolName}
        </span>

        <span className={`font-mono text-[10px] ${
          isActive ? 'text-accent' :
          isDone ? 'text-green-600 dark:text-green-400' :
          isError ? 'text-red-500' : ''
        }`}>
          {toolData.status}
        </span>
      </div>

      {toolData.args != null && (
        <details className="mt-1">
          <summary className="cursor-pointer font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
            arguments
          </summary>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {JSON.stringify(toolData.args, null, 2)}
          </pre>
        </details>
      )}

      {resultStr && (
        <pre className="mt-1 border-t border-neutral-100 pt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {resultStr}
        </pre>
      )}
    </div>
  );
}

type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

interface ToolCallData {
  toolName: string;
  status: ToolCallStatus;
  args: unknown;
  result: unknown;
}

function getToolCallFromParts(parts: unknown): ToolCallData | null {
  if (!parts || typeof parts !== 'object') return null;
  const p = parts as Record<string, unknown>;
  if (typeof p.toolName === 'string') {
    return {
      toolName: p.toolName,
      status: (p.status as ToolCallStatus) || 'completed',
      args: p.args ?? null,
      result: p.result ?? null,
    };
  }
  return null;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
