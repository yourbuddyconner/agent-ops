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
  onRevert?: (messageId: string) => void;
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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800/60">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} onRevert={onRevert} />
        ))}
        {streamingContent && <StreamingMessage content={streamingContent} />}
        {isAgentThinking && !streamingContent && <ThinkingIndicator status={agentStatus} detail={agentStatusDetail} />}
      </div>
    </div>
  );
}
