import { Badge } from '@/components/ui/badge';
import type { Integration } from '@/api/types';
import { formatRelativeTime } from '@/lib/format';

interface SyncStatusBadgeProps {
  status: Integration['status'];
  lastSyncedAt?: Date | null;
}

export function SyncStatusBadge({ status, lastSyncedAt }: SyncStatusBadgeProps) {
  const variants: Record<
    Integration['status'],
    'default' | 'success' | 'warning' | 'error' | 'secondary'
  > = {
    active: 'success',
    pending: 'warning',
    error: 'error',
    disconnected: 'secondary',
  };

  return (
    <div className="flex items-center gap-2">
      <Badge variant={variants[status]}>{status}</Badge>
      {lastSyncedAt && (
        <span className="text-xs tabular-nums text-neutral-400">
          Last synced {formatRelativeTime(lastSyncedAt)}
        </span>
      )}
    </div>
  );
}
