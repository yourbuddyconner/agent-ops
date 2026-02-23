import { useRef, useEffect, useState, useCallback } from 'react';
import type { Message } from '@/api/types';
import type { MessagePart } from '@agent-ops/shared';
import { MessageItem } from './message-item';
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

  for (const msg of messages) {
    if (msg.role === 'user' || msg.role === 'system') {
      turns.push({ type: 'standalone', messages: [msg] });
    } else {
      // Each assistant message is its own turn (self-contained with parts)
      turns.push({ type: 'assistant-turn', messages: [msg] });
    }
  }

  return turns;
}

export function MessageList({ messages, isAgentThinking, agentStatus, agentStatusDetail, onRevert, childSessionEvents, childSessions, connectedUsers }: MessageListProps) {
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

  // Streaming updates messages in-place (no length change),
  // so we track the last message's content length to trigger auto-scroll during streaming.
  const lastMsgLen = messages.length > 0 ? (messages[messages.length - 1].content?.length ?? 0) : 0;

  // Auto-scroll on new messages / streaming content (only when already at bottom)
  useEffect(() => {
    if (isAtBottomRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, lastMsgLen]);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, []);

  const isEmpty = messages.length === 0;
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

              return (
                <AssistantTurn
                  key={turn.messages[0].id}
                  message={turn.messages[0]}
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
            {isAgentThinking && <ThinkingIndicator status={agentStatus} detail={agentStatusDetail} />}
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

/** Renders an assistant turn: a single message with structured parts[]. */
function AssistantTurn({ message }: { message: Message }) {
  const parts = (Array.isArray(message.parts) ? message.parts : []) as MessagePart[];
  const copyText = parts
    .filter((p): p is MessagePart & { type: 'text' } => p.type === 'text')
    .map((p) => (p as { text: string }).text?.trim())
    .filter(Boolean)
    .join('\n\n');

  const sentToChannel = message.channelType ? message : undefined;

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
            {formatTime(message.createdAt)}
          </span>
          {copyText.length > 0 && (
            <MessageCopyButton text={copyText} className="text-[10px]" />
          )}
          {sentToChannel && <ChannelSentBadge channelType={sentToChannel.channelType!} />}
        </div>

        <div className="space-y-1.5 border-l-[1.5px] border-accent/15 pl-3 dark:border-accent/10">
          {parts.map((part, i) => (
            <V2PartRenderer key={i} part={part} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Renders a single V2 message part. */
function V2PartRenderer({ part }: { part: MessagePart }) {
  switch (part.type) {
    case 'text': {
      if (!part.text) return null;
      return (
        <div>
          <MarkdownContent content={part.text} />
          {part.streaming && (
            <span className="inline-block h-3.5 w-1.5 animate-pulse bg-accent/60 ml-0.5 align-text-bottom rounded-sm" />
          )}
        </div>
      );
    }
    case 'tool-call': {
      const toolData: ToolCallData = {
        toolName: part.toolName,
        status: part.status as ToolCallStatus,
        args: part.args ?? null,
        result: part.result ?? null,
      };
      return <ToolCard tool={toolData} />;
    }
    case 'error':
      return (
        <div className="rounded-md border border-red-200/60 bg-red-50/50 px-3 py-2 font-mono text-[12px] text-red-600 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400">
          {part.message}
        </div>
      );
    case 'finish':
      // Finish parts are metadata — nothing to render
      return null;
    default:
      return null;
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
