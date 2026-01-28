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
        'bg-transparent': isUser,
        'bg-surface-1 dark:bg-surface-1': isAssistant,
        'bg-accent/[0.03] dark:bg-accent/[0.04]': isTool,
        'bg-amber-500/[0.04] dark:bg-amber-500/[0.04]': isSystem,
      })}
    >
      <div
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded font-mono text-[10px] font-semibold',
          {
            'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900': isUser,
            'bg-accent/10 text-accent': isAssistant,
            'bg-accent/10 text-accent/70': isTool,
            'bg-amber-500/10 text-amber-600 dark:text-amber-400': isSystem,
          }
        )}
      >
        {isUser ? 'U' : isAssistant ? 'A' : isTool ? 'T' : 'S'}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            {isUser ? 'You' : isAssistant ? 'Assistant' : isTool ? 'Tool' : 'System'}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-neutral-400 dark:text-neutral-500">
            {formatTime(message.createdAt)}
          </span>
        </div>

        <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-neutral-700 text-pretty dark:text-neutral-300">
          {message.content}
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {message.toolCalls.map((tool) => (
              <div
                key={tool.id}
                className="rounded border border-neutral-200 bg-surface-0 p-2 dark:border-neutral-700 dark:bg-surface-0"
              >
                <div className="font-mono text-[11px] font-medium text-neutral-900 dark:text-neutral-100">{tool.name}</div>
                <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
                  {JSON.stringify(tool.arguments, null, 2)}
                </pre>
                {tool.result !== undefined && (
                  <pre className="mt-1 border-t border-neutral-100 pt-1 font-mono text-[11px] leading-relaxed text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
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
