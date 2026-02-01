import { useRef, useEffect } from 'react';
import type { Message } from '@/api/types';
import { MessageItem } from './message-item';
import { StreamingMessage } from './streaming-message';
import { ThinkingIndicator } from './thinking-indicator';
import { MarkdownContent } from './markdown';
import { ToolCard, type ToolCallData, type ToolCallStatus } from './tool-cards';
import { ChildSessionInlineList } from './child-session-card';
import { useDrawer } from '@/routes/sessions/$sessionId';
import type { ChildSessionEvent } from '@/hooks/use-chat';
import type { ChildSessionSummary } from '@/api/types';

type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  isAgentThinking?: boolean;
  agentStatus?: AgentStatus;
  agentStatusDetail?: string;
  onRevert?: (messageId: string) => void;
  childSessionEvents?: ChildSessionEvent[];
  childSessions?: ChildSessionSummary[];
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

export function MessageList({ messages, streamingContent, isAgentThinking, agentStatus, agentStatusDetail, onRevert, childSessionEvents, childSessions }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { activePanel } = useDrawer();
  const compact = activePanel !== null;

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Only auto-scroll if user is near the bottom
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (isNearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  if (messages.length === 0 && !streamingContent) {
    return (
      <div className="flex h-full flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-surface-2/80 dark:bg-surface-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-300 dark:text-neutral-600">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <p className="font-mono text-[11px] tracking-wide text-neutral-400 dark:text-neutral-500">
            Ask or build anything
          </p>
        </div>
      </div>
    );
  }

  const turns = groupIntoTurns(messages);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
      <div className={`space-y-0.5 ${compact ? 'px-3 py-3' : 'mx-auto max-w-3xl px-5 py-5'}`}>
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
        {/* Child session cards */}
        {childSessionEvents && childSessionEvents.length > 0 && (
          <ChildSessionInlineList
            events={childSessionEvents}
            children={childSessions}
          />
        )}
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
    <div className="group relative flex gap-3 py-3 animate-fade-in">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/8 text-accent mt-0.5">
        <BotIcon className="h-3 w-3" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
            Agent
          </span>
          <span className="font-mono text-[10px] tabular-nums text-neutral-300 dark:text-neutral-600">
            {formatTime(firstMessage.createdAt)}
          </span>
        </div>

        <div className="space-y-1.5 border-l-[1.5px] border-accent/15 pl-3 dark:border-accent/10">
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

/** Inline tool card for rendering within an assistant turn — delegates to specialized ToolCard. */
function InlineToolCard({ message }: { message: Message }) {
  const toolData = getToolCallFromParts(message.parts);

  if (!toolData) {
    // Fallback: render content as text
    return <MarkdownContent content={message.content} />;
  }

  return <ToolCard tool={toolData} />;
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

function BotIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
