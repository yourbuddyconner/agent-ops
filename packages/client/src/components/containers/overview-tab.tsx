import type { Container } from '@/api/containers';
import { ContainerStatusSection } from './container-status-section';
import { ContainerConnectionInfo } from './container-connection-info';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

interface OverviewTabProps {
  container: Container;
}

export function OverviewTab({ container }: OverviewTabProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main content */}
      <div className="space-y-6 lg:col-span-2">
        {/* Status section */}
        <ContainerStatusSection container={container} />

        {/* Activity timeline */}
        <ContainerActivityTimeline container={container} />
      </div>

      {/* Sidebar */}
      <div className="space-y-6">
        {/* Connection info */}
        <ContainerConnectionInfo container={container} />

        {/* Container details */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Container ID</span>
              <code className="text-xs text-neutral-900 dark:text-neutral-100">
                {container.id.slice(0, 8)}...
              </code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Created</span>
              <span className="text-sm text-neutral-900 dark:text-neutral-100">
                {formatRelativeTime(container.createdAt)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">Updated</span>
              <span className="text-sm text-neutral-900 dark:text-neutral-100">
                {formatRelativeTime(container.updatedAt)}
              </span>
            </div>
            {container.workspacePath && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">Workspace</span>
                <code className="text-xs text-neutral-900 dark:text-neutral-100 truncate max-w-32">
                  {container.workspacePath}
                </code>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface ContainerActivityTimelineProps {
  container: Container;
}

function ContainerActivityTimeline({ container }: ContainerActivityTimelineProps) {
  // Build activity events from container data
  const events: Array<{
    id: string;
    type: 'started' | 'stopped' | 'error' | 'created';
    timestamp: string;
    message?: string;
  }> = [];

  // Add creation event
  events.push({
    id: 'created',
    type: 'created',
    timestamp: container.createdAt,
    message: 'Container created',
  });

  // Add start event if available
  if (container.startedAt) {
    events.push({
      id: 'started',
      type: 'started',
      timestamp: container.startedAt,
      message: 'Container started',
    });
  }

  // Add stop event if available and container is stopped
  if (container.stoppedAt && container.status === 'stopped') {
    events.push({
      id: 'stopped',
      type: 'stopped',
      timestamp: container.stoppedAt,
      message: 'Container stopped',
    });
  }

  // Add error event if there's an error
  if (container.status === 'error' && container.errorMessage) {
    events.push({
      id: 'error',
      type: 'error',
      timestamp: container.updatedAt,
      message: container.errorMessage,
    });
  }

  // Sort by timestamp descending (most recent first)
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length > 0 ? (
          <div className="relative space-y-4">
            {/* Timeline line */}
            <div className="absolute left-[7px] top-2 -bottom-2 w-px bg-neutral-200 dark:bg-neutral-700" />

            {events.map((event) => (
              <div key={event.id} className="relative flex gap-3">
                {/* Timeline dot */}
                <div
                  className={cn(
                    'relative z-10 mt-1.5 size-3.5 rounded-full border-2',
                    event.type === 'started' && 'border-green-500 bg-green-100 dark:bg-green-900',
                    event.type === 'stopped' && 'border-neutral-400 bg-neutral-100 dark:bg-neutral-700',
                    event.type === 'error' && 'border-red-500 bg-red-100 dark:bg-red-900',
                    event.type === 'created' && 'border-blue-500 bg-blue-100 dark:bg-blue-900'
                  )}
                />

                {/* Event content */}
                <div className="flex-1 pb-4">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-medium',
                        event.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-neutral-900 dark:text-neutral-100'
                      )}
                    >
                      {event.type === 'started'
                        ? 'Started'
                        : event.type === 'stopped'
                        ? 'Stopped'
                        : event.type === 'error'
                        ? 'Error'
                        : 'Created'}
                    </span>
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      {formatRelativeTime(event.timestamp)}
                    </span>
                  </div>
                  {event.message && event.type === 'error' && (
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {event.message}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">No activity recorded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
