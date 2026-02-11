import * as React from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useNotifications,
  useNotificationCount,
  useMarkNotificationRead,
  useMarkNonActionableNotificationsRead,
} from '@/api/orchestrator';
import { formatRelativeTime } from '@/lib/format';
import type { MailboxMessage, MailboxMessageType } from '@/api/types';

export const Route = createFileRoute('/inbox')({
  component: InboxPage,
});

const MESSAGE_TYPE_FILTERS: { value: MailboxMessageType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'notification', label: 'Notifications' },
  { value: 'approval', label: 'Approvals' },
  { value: 'question', label: 'Questions' },
  { value: 'escalation', label: 'Escalations' },
];

function InboxPage() {
  const [typeFilter, setTypeFilter] = React.useState<MailboxMessageType | 'all'>('all');
  const markReadMutation = useMarkNotificationRead();
  const markNonActionableRead = useMarkNonActionableNotificationsRead();
  const clearAttemptedRef = React.useRef(false);

  const { data: inboxData, isLoading } = useNotifications({
    messageType: typeFilter === 'all' ? undefined : typeFilter,
    unreadOnly: false,
    limit: 50,
  });
  const { data: unreadCount } = useNotificationCount();
  const unreadTotal = unreadCount ?? 0;

  React.useEffect(() => {
    if (clearAttemptedRef.current) return;
    if (unreadTotal <= 0) return;
    clearAttemptedRef.current = true;
    markNonActionableRead.mutate();
  }, [unreadTotal, markNonActionableRead]);

  const messages = inboxData?.messages ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description={
          unreadTotal > 0
            ? `${unreadTotal} unread notification${unreadTotal !== 1 ? 's' : ''}`
            : 'Updates from your agents'
        }
      />

      {/* Filter tabs */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {MESSAGE_TYPE_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => {
              setTypeFilter(filter.value);
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
            {typeFilter === 'all' ? 'No notifications yet' : `No ${typeFilter} notifications`}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map((msg) => (
            <InboxMessageItem
              key={msg.id}
              message={msg}
              onMarkRead={() => markReadMutation.mutate(msg.id)}
              markingRead={markReadMutation.isPending && markReadMutation.variables === msg.id}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

// ---------------------------------------------------------------------------
// Thread List Item (renders thread root summary)
// ---------------------------------------------------------------------------

function InboxMessageItem({
  message,
  onMarkRead,
  markingRead,
}: {
  message: MailboxMessage;
  onMarkRead: () => void;
  markingRead: boolean;
}) {
  const senderName =
    message.fromSessionTitle || message.fromUserName || message.fromUserEmail || 'Unknown';
  const displayTime = message.lastActivityAt || message.createdAt;
  const actionRequired = message.messageType === 'approval' || message.messageType === 'question';

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${message.read ? 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900' : 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800'}`}
    >
      {/* Unread dot */}
      <div className="flex items-start gap-3">
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
            <Badge
              variant={
                message.messageType === 'escalation'
                  ? 'error'
                  : message.messageType === 'question' || message.messageType === 'approval'
                    ? 'warning'
                    : 'default'
              }
            >
              {message.messageType}
            </Badge>
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
            {message.content}
          </p>
          <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
            <span className="tabular-nums">{formatRelativeTime(displayTime)}</span>
            {message.contextSessionId && (
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: message.contextSessionId }}
                className="font-medium text-accent hover:underline"
              >
                Open session
              </Link>
            )}
            {actionRequired && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                Action required
              </span>
            )}
          </div>
        </div>

        {!message.read && (
          <button
            onClick={onMarkRead}
            disabled={markingRead}
            className="shrink-0 rounded-md border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {markingRead ? 'Marking...' : 'Mark read'}
          </button>
        )}
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
        <Skeleton key={i} className="h-24 w-full rounded-lg" />
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
