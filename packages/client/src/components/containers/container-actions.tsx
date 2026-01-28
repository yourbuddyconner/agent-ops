import { useState } from 'react';
import type { Container } from '@/api/containers';
import { useStartContainer, useStopContainer } from '@/api/containers';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

interface ContainerActionsProps {
  container: Container;
  /** Called when an action starts */
  onActionStart?: () => void;
  /** Called when an action completes (success or error) */
  onActionComplete?: () => void;
}

export function ContainerActions({
  container,
  onActionStart,
  onActionComplete,
}: ContainerActionsProps) {
  const startContainer = useStartContainer();
  const stopContainer = useStopContainer();
  const [isRestarting, setIsRestarting] = useState(false);

  const isTransitioning = container.status === 'starting' || container.status === 'stopping';
  const canStart = container.status === 'stopped' || container.status === 'error';
  const canStop = container.status === 'running';
  const canRestart = container.status === 'running';

  const handleStart = async () => {
    onActionStart?.();
    try {
      await startContainer.mutateAsync(container.id);
    } catch (err) {
      console.error('Failed to start container:', err);
    } finally {
      onActionComplete?.();
    }
  };

  const handleStop = async () => {
    onActionStart?.();
    try {
      await stopContainer.mutateAsync(container.id);
    } catch (err) {
      console.error('Failed to stop container:', err);
    } finally {
      onActionComplete?.();
    }
  };

  const handleRestart = async () => {
    setIsRestarting(true);
    onActionStart?.();
    try {
      await stopContainer.mutateAsync(container.id);
      // Small delay to ensure state is updated
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await startContainer.mutateAsync(container.id);
    } catch (err) {
      console.error('Failed to restart container:', err);
    } finally {
      setIsRestarting(false);
      onActionComplete?.();
    }
  };

  const isPending = startContainer.isPending || stopContainer.isPending || isRestarting;

  return (
    <div className="flex items-center gap-2">
      {canStart && (
        <Button
          onClick={handleStart}
          disabled={isPending}
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
          disabled={isPending}
          variant="secondary"
          size="sm"
        >
          {stopContainer.isPending && !isRestarting ? (
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

      {canRestart && (
        <Button
          onClick={handleRestart}
          disabled={isPending}
          variant="secondary"
          size="sm"
        >
          {isRestarting ? (
            <>
              <LoadingSpinner className="mr-2 size-4" />
              Restarting...
            </>
          ) : (
            <>
              <RestartIcon className="mr-2 size-4" />
              Restart
            </>
          )}
        </Button>
      )}

      {isTransitioning && (
        <Button disabled variant="secondary" size="sm">
          <LoadingSpinner className="mr-2 size-4" />
          {container.status === 'starting' ? 'Starting...' : 'Stopping...'}
        </Button>
      )}
    </div>
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

function RestartIcon({ className }: { className?: string }) {
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
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
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
