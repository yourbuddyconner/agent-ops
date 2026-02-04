import type { Message } from '@/api/types';
import type { ConnectedUser } from '@/hooks/use-chat';
import { formatTime } from '@/lib/format';
import { MarkdownContent } from './markdown';
import { ToolCard, type ToolCallData, type ToolCallStatus } from './tool-cards';
import { useDrawer } from '@/routes/sessions/$sessionId';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';

interface MessageItemProps {
  message: Message;
  onRevert?: (messageId: string) => void;
  connectedUsers?: ConnectedUser[];
}

export function MessageItem({ message, onRevert, connectedUsers }: MessageItemProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const isSystem = message.role === 'system';
  const { activePanel } = useDrawer();
  const compact = activePanel !== null;

  // Extract base64 screenshot parts if present
  const screenshotParts = getScreenshotParts(message.parts);

  // Extract structured tool data from parts (for tool messages)
  const toolData = isTool ? getToolCallFromParts(message.parts) : null;

  // User messages: right-aligned bubble with author avatar
  if (isUser) {
    // Resolve author avatar from connectedUsers or message fields
    const authorName = message.authorName || message.authorEmail;
    const connectedUser = message.authorId
      ? connectedUsers?.find((u) => u.id === message.authorId)
      : undefined;
    const avatarUrl = connectedUser?.avatarUrl;
    const initials = (authorName || '?')
      .split(/[\s@]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0].toUpperCase())
      .join('');

    return (
      <div className="group relative flex justify-end gap-2 py-2.5 animate-fade-in">
        <div className={compact ? 'max-w-[90%]' : 'max-w-[75%]'}>
          {authorName && (
            <div className="mb-1 flex items-center justify-end gap-1.5 px-1">
              <span className="font-mono text-[10px] font-medium text-neutral-400 dark:text-neutral-500">
                {message.authorName || message.authorEmail}
              </span>
            </div>
          )}
          <div className="rounded-2xl rounded-br-md bg-neutral-900 px-4 py-2.5 text-white shadow-sm dark:bg-neutral-100 dark:text-neutral-900 dark:shadow-none [&_.markdown-body]:text-white/95 [&_.markdown-body]:dark:text-neutral-900">
            <MarkdownContent content={message.content} />
          </div>
          <div className="mt-1 flex items-center justify-end gap-2 px-1">
            <span className="font-mono text-[9px] tabular-nums text-neutral-300 dark:text-neutral-600">
              {formatTime(message.createdAt)}
            </span>
            {onRevert && (
              <button
                type="button"
                onClick={() => onRevert(message.id)}
                className="rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-medium text-neutral-300 opacity-0 transition-all hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              >
                undo
              </button>
            )}
          </div>
        </div>
        <Avatar className="mt-1 h-5 w-5 shrink-0">
          {avatarUrl && <AvatarImage src={avatarUrl} alt={authorName || ''} />}
          <AvatarFallback className="text-[8px]">{initials}</AvatarFallback>
        </Avatar>
      </div>
    );
  }

  // System messages: centered, compact
  if (isSystem) {
    return (
      <div className="flex justify-center py-3">
        <div className="flex items-center gap-2 rounded-full bg-amber-500/[0.05] px-3 py-1 dark:bg-amber-500/[0.07]">
          <div className="h-1 w-1 rounded-full bg-amber-400/60" />
          <p className="text-center font-mono text-[10px] text-amber-600 dark:text-amber-400/80">
            {message.content}
          </p>
        </div>
      </div>
    );
  }

  // Tool messages (shouldn't appear standalone often, but handle it)
  if (isTool && toolData) {
    return (
      <div className="py-1">
        <ToolCard tool={toolData} />
      </div>
    );
  }

  // Fallback (assistant messages rendered standalone — rare, usually in AssistantTurn)
  return (
    <div className="group relative flex gap-3 py-3 animate-fade-in">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/8 text-accent mt-0.5">
        <BotIcon className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
            {isTool ? 'Tool' : 'Agent'}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-neutral-300 dark:text-neutral-600">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <div className="border-l-[1.5px] border-accent/15 pl-3 dark:border-accent/10">
          <MarkdownContent content={message.content} />
        </div>
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
      </div>
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
