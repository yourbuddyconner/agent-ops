import { useRef, useEffect, useState, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import type { Message } from '@/api/types';
import { MessageItem } from './message-item';
import { StreamingMessage } from './streaming-message';
import { ThinkingIndicator } from './thinking-indicator';
import { MarkdownContent } from './markdown';
import { ToolCard, type ToolCallData, type ToolCallStatus } from './tool-cards';
import { ChildSessionInlineList } from './child-session-card';
import { useDrawer } from '@/routes/sessions/$sessionId';
import type { ChildSessionEvent, ConnectedUser } from '@/hooks/use-chat';
import type { ChildSessionSummary } from '@/api/types';
import { MessageCopyButton } from './message-copy-button';

type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error' | 'queued';

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  isAgentThinking?: boolean;
  agentStatus?: AgentStatus;
  agentStatusDetail?: string;
  onRevert?: (messageId: string) => void;
  childSessionEvents?: ChildSessionEvent[];
  childSessions?: ChildSessionSummary[];
  connectedUsers?: ConnectedUser[];
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

export function MessageList({ messages, streamingContent, isAgentThinking, agentStatus, agentStatusDetail, onRevert, childSessionEvents, childSessions, connectedUsers }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { activePanel } = useDrawer();
  const compact = activePanel !== null;

  // Scroll tracking — ref for auto-scroll logic, state for button visibility
  const isAtBottomRef = useRef(true);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const didInitialScrollRef = useRef(false);

  // Track scroll position via scroll listener
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function handleScroll() {
      if (!el) return;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      isAtBottomRef.current = atBottom;
      setIsAtBottom(atBottom);
    }

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Initial load: scroll to bottom when messages first appear
  useEffect(() => {
    if (didInitialScrollRef.current) return;
    if (messages.length > 0 && scrollRef.current) {
      didInitialScrollRef.current = true;
      // Use requestAnimationFrame to ensure DOM has rendered the messages
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          isAtBottomRef.current = true;
          setIsAtBottom(true);
        }
      });
    }
  }, [messages.length]);

  // Auto-scroll on new messages / streaming content (only when already at bottom)
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  const isEmpty = messages.length === 0 && !streamingContent;
  const turns = isEmpty ? [] : groupIntoTurns(messages);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden scroll-smooth">
        {isEmpty ? (
          <div className="flex h-full items-center justify-center">
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
        ) : (
          <div className={`space-y-0.5 ${compact ? 'px-3 py-3' : 'mx-auto max-w-3xl px-5 py-5'}`}>
            {turns.map((turn) => {
              if (turn.type === 'standalone') {
                const msg = turn.messages[0];
                return <MessageItem key={msg.id} message={msg} onRevert={onRevert} connectedUsers={connectedUsers} />;
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
        )}
      </div>

      {/* Scroll to bottom button */}
      {!isEmpty && (
        <button
          type="button"
          onClick={scrollToBottom}
          className={`absolute bottom-3 left-1/2 z-10 -translate-x-1/2 flex items-center gap-1 rounded-full border border-neutral-200 bg-white/90 px-2.5 py-1 font-mono text-[10px] font-medium text-neutral-500 shadow-sm backdrop-blur transition-all hover:bg-white hover:text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800/90 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 ${isAtBottom ? 'pointer-events-none translate-y-2 opacity-0' : 'translate-y-0 opacity-100'}`}
        >
          <ChevronDownIcon className="h-3 w-3" />
          Bottom
        </button>
      )}
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
  | { kind: 'tool'; message: Message }
  | { kind: 'forwarded'; message: Message; sourceTitle: string; sourceSessionId?: string; originalRole: string };

/** Check if a message has forwarded metadata in its parts. */
function isForwardedMessage(msg: Message): boolean {
  if (!msg.parts || typeof msg.parts !== 'object') return false;
  return (msg.parts as Record<string, unknown>).forwarded === true;
}

function mergeWithOverlap(base: string, incoming: string): string {
  if (!incoming) return base;
  if (!base) return incoming;
  if (base === incoming) return base;
  if (incoming.startsWith(base)) return incoming;
  if (base.endsWith(incoming)) return base;

  const maxOverlap = Math.min(base.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (base.slice(-overlap) === incoming.slice(0, overlap)) {
      return base + incoming.slice(overlap);
    }
  }
  return base + incoming;
}

function mergeAssistantSegments(messages: Message[]): TurnSegment[] {
  const segments: TurnSegment[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      segments.push({ kind: 'tool', message: msg });
    } else if (isForwardedMessage(msg)) {
      const parts = msg.parts as Record<string, unknown>;
      segments.push({
        kind: 'forwarded',
        message: msg,
        sourceTitle: (parts.sourceSessionTitle as string) || 'Session',
        sourceSessionId: parts.sourceSessionId as string | undefined,
        originalRole: (parts.originalRole as string) || 'assistant',
      });
    } else if (msg.content) {
      const last = segments[segments.length - 1];
      if (last && last.kind === 'text') {
        // Merge incrementally with overlap-aware dedupe to avoid replayed snapshots.
        last.content = mergeWithOverlap(last.content, msg.content);
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
  const copyText = segments
    .map((seg) => {
      if (seg.kind === 'text') return seg.content;
      if (seg.kind === 'forwarded') return seg.message.content;
      return '';
    })
    .map((content) => content.trim())
    .filter((content) => content.length > 0)
    .join('\n\n');

  // Check if any message in the turn was forwarded to an external channel
  const sentToChannel = messages.find((m) => m.role === 'assistant' && m.channelType);

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
          {copyText.length > 0 && (
            <MessageCopyButton text={copyText} className="text-[10px]" />
          )}
          {sentToChannel && <ChannelSentBadge channelType={sentToChannel.channelType!} />}
        </div>

        <div className="space-y-1.5 border-l-[1.5px] border-accent/15 pl-3 dark:border-accent/10">
          {segments.map((seg) =>
            seg.kind === 'tool' ? (
              <InlineToolCard key={seg.message.id} message={seg.message} />
            ) : seg.kind === 'forwarded' ? (
              <ForwardedMessage
                key={seg.message.id}
                content={seg.message.content}
                sourceTitle={seg.sourceTitle}
                sourceSessionId={seg.sourceSessionId}
                originalRole={seg.originalRole}
              />
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

/** Renders a forwarded message in a quote-style block with source attribution. */
function ForwardedMessage({ content, sourceTitle, sourceSessionId, originalRole }: { content: string; sourceTitle: string; sourceSessionId?: string; originalRole: string }) {
  const roleLabel = originalRole === 'user' ? 'User' : originalRole === 'assistant' ? 'Agent' : originalRole === 'tool' ? 'Tool' : originalRole;

  return (
    <div className="ml-3 border-l-2 border-neutral-200/70 pl-3 dark:border-neutral-700/60">
      <div className="rounded-md border border-neutral-200/60 bg-neutral-50/60 px-3 py-2 dark:border-neutral-700/40 dark:bg-neutral-800/35">
        <div className="mb-1 flex items-center gap-1.5">
          <ForwardIcon className="h-3 w-3 text-neutral-400 dark:text-neutral-500" />
          <span className="font-mono text-[9px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
            Forwarded from {sourceTitle} &middot; {roleLabel}
          </span>
          {sourceSessionId && (
            <>
              <span className="text-[9px] text-neutral-300 dark:text-neutral-600">•</span>
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: sourceSessionId }}
                className="font-mono text-[9px] font-medium uppercase tracking-wider text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
              >
                Open Session
              </Link>
            </>
          )}
        </div>
        <div className="text-[13px] leading-relaxed text-neutral-600 dark:text-neutral-300">
          <MarkdownContent content={content} />
        </div>
      </div>
    </div>
  );
}

function ForwardIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="15 17 20 12 15 7" />
      <path d="M4 18v-2a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

function ChannelSentBadge({ channelType }: { channelType: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[9px] font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
      {channelType === 'telegram' && <TelegramIcon className="h-2.5 w-2.5" />}
      <SendIcon className="h-2 w-2" />
      sent to {channelType}
    </span>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.74-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
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
