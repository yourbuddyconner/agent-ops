import * as React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  useInbox,
  useInboxCount,
  useMarkInboxRead,
  useReplyToInbox,
} from '@/api/orchestrator';
import { formatRelativeTime } from '@/lib/format';
import type { MailboxMessage, MailboxMessageType } from '@/api/types';

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
});

const MESSAGE_TYPE_FILTERS: { value: MailboxMessageType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'message', label: 'Messages' },
  { value: 'notification', label: 'Notifications' },
  { value: 'question', label: 'Questions' },
  { value: 'escalation', label: 'Escalations' },
];

const MESSAGE_TYPE_STYLES: Record<string, string> = {
  message: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  notification: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400',
  question: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  escalation: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

function InboxPage() {
  const [typeFilter, setTypeFilter] = React.useState<MailboxMessageType | 'all'>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const { data: inboxData, isLoading } = useInbox({
    messageType: typeFilter === 'all' ? undefined : typeFilter,
    unreadOnly: false,
    limit: 50,
  });
  const { data: unreadCount } = useInboxCount();

  const messages = inboxData?.messages ?? [];
  const selectedMessage = messages.find((m) => m.id === selectedId);

  return (
    <PageContainer>
      <PageHeader
        title="Inbox"
        description={
          unreadCount && unreadCount > 0
            ? `${unreadCount} unread message${unreadCount !== 1 ? 's' : ''}`
            : 'Messages from your agents'
        }
      />

      {/* Filter tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {MESSAGE_TYPE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => {
              setTypeFilter(filter.value);
              setSelectedId(null);
            }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              typeFilter === filter.value
                ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-700'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <InboxSkeleton />
      ) : messages.length === 0 ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
          <InboxEmptyIcon className="mx-auto mb-3 h-10 w-10 text-neutral-300 dark:text-neutral-600" />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            {typeFilter === 'all' ? 'No messages yet' : `No ${typeFilter} messages`}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
          {/* Message list */}
          <div className="space-y-1">
            {messages.map((msg) => (
              <InboxMessageItem
                key={msg.id}
                message={msg}
                selected={selectedId === msg.id}
                onSelect={() => setSelectedId(msg.id)}
              />
            ))}
          </div>

          {/* Detail panel */}
          <div className="hidden lg:block">
            {selectedMessage ? (
              <InboxMessageDetail message={selectedMessage} />
            ) : (
              <div className="rounded-lg border border-neutral-200 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-800">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Select a message to view details
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Message Item
// ---------------------------------------------------------------------------

function InboxMessageItem({
  message,
  selected,
  onSelect,
}: {
  message: MailboxMessage;
  selected: boolean;
  onSelect: () => void;
}) {
  const markRead = useMarkInboxRead();

  function handleClick() {
    onSelect();
    if (!message.read) {
      markRead.mutate(message.id);
    }
  }

  const senderName =
    message.fromSessionTitle || message.fromUserName || message.fromUserEmail || 'Unknown';

  return (
    <button
      onClick={handleClick}
      className={`group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? 'border-accent/30 bg-accent/5 dark:border-accent/20 dark:bg-accent/5'
          : message.read
            ? 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800/50'
            : 'border-neutral-200 bg-white hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-800/80'
      }`}
    >
      {/* Unread dot */}
      <div className="mt-1.5 shrink-0">
        {!message.read ? (
          <span className="block h-2 w-2 rounded-full bg-accent" />
        ) : (
          <span className="block h-2 w-2" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-2">
          <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {senderName}
          </span>
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${MESSAGE_TYPE_STYLES[message.messageType] ?? MESSAGE_TYPE_STYLES.message}`}
          >
            {message.messageType}
          </span>
        </div>
        <p className="truncate text-xs text-neutral-600 dark:text-neutral-400">
          {message.content}
        </p>
      </div>

      <span className="shrink-0 text-[11px] text-neutral-400 tabular-nums dark:text-neutral-500">
        {formatRelativeTime(message.createdAt)}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Message Detail
// ---------------------------------------------------------------------------

function InboxMessageDetail({ message }: { message: MailboxMessage }) {
  const markRead = useMarkInboxRead();
  const replyMutation = useReplyToInbox();
  const [replyText, setReplyText] = React.useState('');

  React.useEffect(() => {
    if (!message.read) {
      markRead.mutate(message.id);
    }
    // Only on message change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);

  function handleReply(e: React.FormEvent) {
    e.preventDefault();
    if (!replyText.trim()) return;
    replyMutation.mutate(
      { messageId: message.id, content: replyText.trim() },
      {
        onSuccess: () => setReplyText(''),
      }
    );
  }

  const senderName =
    message.fromSessionTitle || message.fromUserName || message.fromUserEmail || 'Unknown';

  return (
    <div className="rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800">
      {/* Header */}
      <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {senderName}
            </span>
            <Badge
              variant={
                message.messageType === 'escalation'
                  ? 'error'
                  : message.messageType === 'question'
                    ? 'warning'
                    : 'default'
              }
            >
              {message.messageType}
            </Badge>
          </div>
          <span className="text-xs text-neutral-400 tabular-nums dark:text-neutral-500">
            {formatRelativeTime(message.createdAt)}
          </span>
        </div>
        {message.contextSessionId && (
          <div className="mt-1.5 flex items-center gap-1.5 text-xs text-neutral-400 dark:text-neutral-500">
            <span>Session:</span>
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: message.contextSessionId }}
              className="font-medium text-accent hover:underline"
            >
              {message.contextSessionId.slice(0, 8)}...
            </Link>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4">
        <p className="whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
          {message.content}
        </p>
      </div>

      {/* Reply */}
      <div className="border-t border-neutral-200 p-4 dark:border-neutral-700">
        <form onSubmit={handleReply} className="flex gap-2">
          <input
            type="text"
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Type a reply..."
            className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus:border-neutral-400 dark:focus:ring-neutral-400"
          />
          <Button
            type="submit"
            disabled={!replyText.trim() || replyMutation.isPending}
            className="shrink-0"
          >
            {replyMutation.isPending ? 'Sending...' : 'Reply'}
          </Button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton & Icons
// ---------------------------------------------------------------------------

function InboxSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}

function InboxEmptyIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  );
}
