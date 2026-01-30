import { useRef, useEffect, useCallback, useState } from 'react';
import type { Message } from '@/api/types';
import { MessageItem } from './message-item';
import { StreamingMessage } from './streaming-message';
import { ThinkingIndicator } from './thinking-indicator';

type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
  isAgentThinking?: boolean;
  agentStatus?: AgentStatus;
  agentStatusDetail?: string;
}

export function MessageList({ messages, streamingContent, isAgentThinking, agentStatus, agentStatusDetail }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  // Check if the user is scrolled near the bottom
  const checkNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const threshold = 80; // px from bottom
    return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  // Track scroll position
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      setIsNearBottom(checkNearBottom());
    };

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [checkNearBottom]);

  // Auto-scroll only when user is near the bottom
  useEffect(() => {
    if (isNearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent, isAgentThinking, isNearBottom]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsNearBottom(true);
  }, []);

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

  return (
    <div ref={containerRef} className="relative flex-1 overflow-y-auto">
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        {streamingContent && <StreamingMessage content={streamingContent} />}
        {isAgentThinking && !streamingContent && <ThinkingIndicator status={agentStatus} detail={agentStatusDetail} />}
      </div>
      <div ref={bottomRef} />

      {/* Scroll-to-bottom button when user has scrolled up */}
      {!isNearBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 bg-surface-0 shadow-md transition-colors hover:bg-surface-1 dark:border-neutral-700 dark:bg-surface-1 dark:hover:bg-surface-2"
          aria-label="Scroll to bottom"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 dark:text-neutral-400">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}
