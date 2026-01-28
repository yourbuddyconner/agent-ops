import { Link } from '@tanstack/react-router';
import type { Container } from '@/api/containers';
import { useStartContainer, useStopContainer, useDeleteContainer } from '@/api/containers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

interface ContainerCardProps {
  container: Container;
}

const STATUS_CONFIG: Record<Container['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'secondary'; pulse?: boolean }> = {
  running: { label: 'Running', variant: 'success', pulse: true },
  stopped: { label: 'Stopped', variant: 'secondary' },
  starting: { label: 'Starting', variant: 'warning', pulse: true },
  stopping: { label: 'Stopping', variant: 'warning', pulse: true },
  error: { label: 'Error', variant: 'error' },
};

const INSTANCE_SIZE_LABELS: Record<Container['instanceSize'], string> = {
  dev: '256 MB',
  basic: '1 GB',
  standard: '4 GB',
};

export function ContainerCard({ container }: ContainerCardProps) {
  const startContainer = useStartContainer();
  const stopContainer = useStopContainer();
  const deleteContainer = useDeleteContainer();

  const statusConfig = STATUS_CONFIG[container.status];
  const isTransitioning = container.status === 'starting' || container.status === 'stopping';
  const canStart = container.status === 'stopped' || container.status === 'error';
  const canStop = container.status === 'running';

  const handleStart = async () => {
    try {
      await startContainer.mutateAsync(container.id);
    } catch (err) {
      console.error('Failed to start container:', err);
    }
  };

  const handleStop = async () => {
    try {
      await stopContainer.mutateAsync(container.id);
    } catch (err) {
      console.error('Failed to stop container:', err);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete "${container.name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await deleteContainer.mutateAsync(container.id);
    } catch (err) {
      console.error('Failed to delete container:', err);
    }
  };

  return (
    <Card className="group relative">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Link
              to="/containers/$containerId"
              params={{ containerId: container.id }}
              className="hover:underline"
            >
              <CardTitle className="truncate text-base">{container.name}</CardTitle>
            </Link>
            <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {INSTANCE_SIZE_LABELS[container.instanceSize]} RAM
            </p>
          </div>
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
            <Badge variant={statusConfig.variant} className="text-xs">
              {statusConfig.label}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1 text-sm text-neutral-500 dark:text-neutral-400">
          {container.region && (
            <p>
              <span className="text-neutral-400 dark:text-neutral-500">Region:</span>{' '}
              {container.region}
            </p>
          )}
          <p>
            <span className="text-neutral-400 dark:text-neutral-500">Auto-sleep:</span>{' '}
            {container.autoSleepMinutes}m
          </p>
          {container.lastActiveAt && (
            <p>
              <span className="text-neutral-400 dark:text-neutral-500">Last active:</span>{' '}
              {formatRelativeTime(container.lastActiveAt)}
            </p>
          )}
          {container.errorMessage && (
            <p className="text-pretty text-red-600 dark:text-red-400">
              {container.errorMessage}
            </p>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          {canStart && (
            <Button
              onClick={handleStart}
              disabled={startContainer.isPending}
              className="flex-1"
              size="sm"
            >
              {startContainer.isPending ? (
                <>
                  <LoadingSpinner className="mr-2 size-4" />
                  Starting...
                </>
              ) : (
                <>
                  <PlayIcon className="mr-2 size-4" />
                  Start
                </>
              )}
            </Button>
          )}
          {canStop && (
            <Button
              onClick={handleStop}
              disabled={stopContainer.isPending}
              variant="secondary"
              className="flex-1"
              size="sm"
            >
              {stopContainer.isPending ? (
                <>
                  <LoadingSpinner className="mr-2 size-4" />
                  Stopping...
                </>
              ) : (
                <>
                  <StopIcon className="mr-2 size-4" />
                  Stop
                </>
              )}
            </Button>
          )}
          {isTransitioning && (
            <Button disabled variant="secondary" className="flex-1" size="sm">
              <LoadingSpinner className="mr-2 size-4" />
              {container.status === 'starting' ? 'Starting...' : 'Stopping...'}
            </Button>
          )}
          <Button
            onClick={handleDelete}
            disabled={deleteContainer.isPending || isTransitioning}
            variant="secondary"
            size="sm"
            className="px-2"
            title="Delete container"
          >
            <TrashIcon className="size-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="14" height="14" x="5" y="5" rx="2" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

function LoadingSpinner({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('animate-spin', className)}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
