import type { Message } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';

interface MessageItemProps {
  message: Message;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';

  return (
    <div
      className={cn('flex gap-3 px-4 py-3', {
        'bg-neutral-50': isAssistant,
        'bg-blue-50': isTool,
        'bg-yellow-50': isSystem,
      })}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-medium',
          {
            'bg-neutral-900 text-white': isUser,
            'bg-neutral-200 text-neutral-700': isAssistant,
            'bg-blue-200 text-blue-700': isTool,
            'bg-yellow-200 text-yellow-700': isSystem,
          }
        )}
      >
        {isUser ? 'U' : isAssistant ? 'A' : isTool ? 'T' : 'S'}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-900">
            {isUser ? 'You' : isAssistant ? 'Assistant' : isTool ? 'Tool' : 'System'}
          </span>
          <span className="text-xs tabular-nums text-neutral-400">
            {formatTime(message.createdAt)}
          </span>
        </div>

        <div className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 text-pretty">
          {message.content}
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.toolCalls.map((tool) => (
              <div
                key={tool.id}
                className="rounded border border-neutral-200 bg-white p-2 text-xs"
              >
                <div className="font-medium text-neutral-900">{tool.name}</div>
                <pre className="mt-1 overflow-x-auto text-neutral-600">
                  {JSON.stringify(tool.arguments, null, 2)}
                </pre>
                {tool.result !== undefined && (
                  <pre className="mt-1 border-t border-neutral-100 pt-1 text-neutral-600">
                    {JSON.stringify(tool.result, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
