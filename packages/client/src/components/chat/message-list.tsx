import { useRef, useEffect } from 'react';
import type { Message } from '@/api/types';
import { MessageItem } from './message-item';
import { StreamingMessage } from './streaming-message';

interface MessageListProps {
  messages: Message[];
  streamingContent?: string;
}

export function MessageList({ messages, streamingContent }: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  if (messages.length === 0 && !streamingContent) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-neutral-500 text-pretty">
          Start a conversation by sending a message.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto">
      <div className="divide-y divide-neutral-100">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
        {streamingContent && <StreamingMessage content={streamingContent} />}
      </div>
      <div ref={bottomRef} />
    </div>
  );
}
