import type { Message } from '@/api/types';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import { MarkdownContent } from './markdown';

interface MessageItemProps {
  message: Message;
  onRevert?: (messageId: string) => void;
}

type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error';

interface ToolCallData {
  toolName: string;
  status: ToolCallStatus;
  args: unknown;
  result: unknown;
}

export function MessageItem({ message, onRevert }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';

  // Extract base64 screenshot parts if present
  const screenshotParts = getScreenshotParts(message.parts);

  // Extract structured tool data from parts (for tool messages)
  const toolData = isTool ? getToolCallFromParts(message.parts) : null;

  return (
    <div
      className={cn('group relative flex gap-3 px-4 py-3', {
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

        {/* Structured tool card for tool messages */}
        {isTool && toolData ? (
          <ToolCard tool={toolData} />
        ) : (
          <MarkdownContent content={message.content} />
        )}

        {screenshotParts.length > 0 && (
          <div className="mt-2 space-y-2">
            {screenshotParts.map((src, i) => (
              <img
                key={i}
                src={src}
                alt="Screenshot"
                loading="lazy"
                className="max-h-[400px] max-w-full rounded-md border border-neutral-200 object-contain dark:border-neutral-700"
              />
            ))}
          </div>
        )}

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

      {isUser && onRevert && (
        <button
          type="button"
          onClick={() => onRevert(message.id)}
          className="absolute right-3 top-3 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
        >
          Undo
        </button>
      )}
    </div>
  );
}

/** Structured tool call card with live status indicator */
function ToolCard({ tool }: { tool: ToolCallData }) {
  const isActive = tool.status === 'pending' || tool.status === 'running';
  const isDone = tool.status === 'completed';
  const isError = tool.status === 'error';

  // Truncate long results (e.g., base64 blobs)
  const resultStr = (() => {
    if (tool.result === null || tool.result === undefined) return null;
    const s = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2);
    if (s.length > 500) return s.slice(0, 500) + '\n... (truncated)';
    return s;
  })();

  return (
    <div className="mt-1 rounded border border-neutral-200 bg-surface-0 p-2 dark:border-neutral-700 dark:bg-surface-0">
      <div className="flex items-center gap-2">
        {/* Status indicator */}
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
          {tool.toolName}
        </span>

        <span className={cn('font-mono text-[10px]', {
          'text-accent': isActive,
          'text-green-600 dark:text-green-400': isDone,
          'text-red-500': isError,
        })}>
          {tool.status}
        </span>
      </div>

      {/* Args (collapsed) */}
      {tool.args != null && (
        <details className="mt-1">
          <summary className="cursor-pointer font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
            arguments
          </summary>
          <pre className="mt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-400">
            {JSON.stringify(tool.args, null, 2)}
          </pre>
        </details>
      )}

      {/* Result (when completed) */}
      {resultStr && (
        <pre className="mt-1 border-t border-neutral-100 pt-1 overflow-x-auto font-mono text-[11px] leading-relaxed text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {resultStr}
        </pre>
      )}
    </div>
  );
}

/** Extract structured tool call data from parts. */
function getToolCallFromParts(parts: unknown): ToolCallData | null {
  if (!parts || typeof parts !== 'object') return null;

  const p = parts as Record<string, unknown>;

  // Parts is { toolName, status, args, result } from the DO upsert
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

/** Extract base64 image data URIs from message parts (if they exist). */
function getScreenshotParts(parts: unknown): string[] {
  if (!parts || typeof parts !== 'object') return [];

  const result: string[] = [];

  // Normalize to array — DO may store a single object or an array
  const items = Array.isArray(parts) ? parts : [parts];

  for (const part of items) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;

    // Match { type: 'screenshot', data: base64 } (from DO screenshot messages)
    if ((p.type === 'screenshot' || p.type === 'image') && typeof p.data === 'string') {
      const mime = typeof p.mimeType === 'string' ? p.mimeType : 'image/png';
      result.push(`data:${mime};base64,${p.data}`);
    }
  }

  return result;
}
