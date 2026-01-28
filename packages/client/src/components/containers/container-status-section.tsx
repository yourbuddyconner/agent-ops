import type { Container } from '@/api/containers';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

interface ContainerStatusSectionProps {
  container: Container;
}

const STATUS_CONFIG: Record<
  Container['status'],
  { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'secondary'; pulse?: boolean }
> = {
  running: { label: 'Running', variant: 'success', pulse: true },
  stopped: { label: 'Stopped', variant: 'secondary' },
  starting: { label: 'Starting', variant: 'warning', pulse: true },
  stopping: { label: 'Stopping', variant: 'warning', pulse: true },
  error: { label: 'Error', variant: 'error' },
};

const INSTANCE_SIZE_LABELS: Record<Container['instanceSize'], string> = {
  dev: '256 MB RAM',
  basic: '1 GB RAM',
  standard: '4 GB RAM',
};

export function ContainerStatusSection({ container }: ContainerStatusSectionProps) {
  const statusConfig = STATUS_CONFIG[container.status];
  const uptime = container.startedAt ? calculateUptime(container.startedAt) : null;
  const sleepCountdown = calculateSleepCountdown(container);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Status</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status indicator */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">Current Status</span>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'size-2.5 rounded-full',
                statusConfig.variant === 'success' && 'bg-green-500',
                statusConfig.variant === 'secondary' && 'bg-neutral-400',
                statusConfig.variant === 'warning' && 'bg-yellow-500',
                statusConfig.variant === 'error' && 'bg-red-500',
                statusConfig.pulse && 'animate-pulse'
              )}
            />
            <Badge variant={statusConfig.variant}>{statusConfig.label}</Badge>
          </div>
        </div>

        {/* Instance size */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">Instance Size</span>
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {INSTANCE_SIZE_LABELS[container.instanceSize]}
          </span>
        </div>

        {/* Uptime (only when running) */}
        {container.status === 'running' && uptime && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">Uptime</span>
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 tabular-nums">
              {uptime}
            </span>
          </div>
        )}

        {/* Last active */}
        {container.lastActiveAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">Last Active</span>
            <span className="text-sm text-neutral-900 dark:text-neutral-100">
              {formatRelativeTime(container.lastActiveAt)}
            </span>
          </div>
        )}

        {/* Auto-sleep countdown (only when running) */}
        {container.status === 'running' && sleepCountdown && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">Auto-sleep in</span>
            <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 tabular-nums">
              {sleepCountdown}
            </span>
          </div>
        )}

        {/* Auto-sleep setting */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">Auto-sleep</span>
          <span className="text-sm text-neutral-900 dark:text-neutral-100">
            {container.autoSleepMinutes} min of inactivity
          </span>
        </div>

        {/* Started at */}
        {container.startedAt && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">Started</span>
            <span className="text-sm text-neutral-900 dark:text-neutral-100">
              {formatRelativeTime(container.startedAt)}
            </span>
          </div>
        )}

        {/* Stopped at */}
        {container.stoppedAt && container.status === 'stopped' && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500 dark:text-neutral-400">Stopped</span>
            <span className="text-sm text-neutral-900 dark:text-neutral-100">
              {formatRelativeTime(container.stoppedAt)}
            </span>
          </div>
        )}

        {/* Error message */}
        {container.errorMessage && (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            <p className="text-sm text-red-600 dark:text-red-400">{container.errorMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function calculateUptime(startedAt: string): string {
  const startTime = new Date(startedAt).getTime();
  if (isNaN(startTime)) return 'N/A';

  const now = Date.now();
  const diffMs = Math.max(0, now - startTime);

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function calculateSleepCountdown(container: Container): string | null {
  if (container.status !== 'running' || !container.lastActiveAt) {
    return null;
  }

  const lastActiveTime = new Date(container.lastActiveAt).getTime();
  if (isNaN(lastActiveTime)) return null;

  const sleepTime = lastActiveTime + container.autoSleepMinutes * 60 * 1000;
  const now = Date.now();
  const remainingMs = sleepTime - now;

  if (remainingMs <= 0) {
    return 'soon';
  }

  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
