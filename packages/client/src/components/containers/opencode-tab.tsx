import { useState, useEffect } from 'react';
import type { Container } from '@/api/containers';
import { useStartContainer } from '@/api/containers';
import { useContainerHeartbeatInterval } from '@/hooks/use-container-heartbeat';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/cn';

interface OpenCodeTabProps {
  container: Container;
}

export function OpenCodeTab({ container }: OpenCodeTabProps) {
  const startContainer = useStartContainer();
  const [iframeLoading, setIframeLoading] = useState(true);
  const [iframeError, setIframeError] = useState(false);

  // Start heartbeat when container is running and this tab is visible
  useContainerHeartbeatInterval({
    containerId: container.id,
    enabled: container.status === 'running',
    interval: 30000, // 30 seconds
  });

  // Reset iframe state when container status changes
  useEffect(() => {
    setIframeLoading(true);
    setIframeError(false);
  }, [container.status]);

  const handleStart = async () => {
    try {
      await startContainer.mutateAsync(container.id);
    } catch (err) {
      console.error('Failed to start container:', err);
    }
  };

  const handleIframeLoad = () => {
    setIframeLoading(false);
    setIframeError(false);
  };

  const handleIframeError = () => {
    setIframeLoading(false);
    setIframeError(true);
  };

  // Container not running - show start prompt
  if (container.status !== 'running') {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <ContainerIcon className="size-16 text-neutral-300" />
          <h3 className="mt-4 text-lg font-medium text-neutral-900">
            Container is not running
          </h3>
          <p className="mt-1 text-sm text-neutral-500 text-center max-w-sm">
            {container.status === 'starting' || container.status === 'stopping' ? (
              `Container is ${container.status}...`
            ) : container.status === 'error' ? (
              'Container encountered an error. Try starting it again.'
            ) : (
              'Start the container to access the OpenCode development environment.'
            )}
          </p>
          {(container.status === 'stopped' || container.status === 'error') && (
            <Button
              onClick={handleStart}
              disabled={startContainer.isPending}
              className="mt-6"
            >
              {startContainer.isPending ? (
                <>
                  <LoadingSpinner className="mr-2 size-4" />
                  Starting...
                </>
              ) : (
                <>
                  <PlayIcon className="mr-2 size-4" />
                  Start Container
                </>
              )}
            </Button>
          )}
          {(container.status === 'starting' || container.status === 'stopping') && (
            <div className="mt-6 flex items-center gap-2 text-neutral-500">
              <LoadingSpinner className="size-4" />
              <span className="text-sm">
                {container.status === 'starting' ? 'Starting container...' : 'Stopping container...'}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const proxyUrl = `/api/containers/${container.id}/proxy/`;

  return (
    <div className="relative h-[calc(100vh-280px)] min-h-[500px]">
      {/* Loading overlay */}
      {iframeLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white rounded-lg border border-neutral-200">
          <div className="flex flex-col items-center gap-4">
            <LoadingSpinner className="size-8 text-neutral-400" />
            <p className="text-sm text-neutral-500">Loading OpenCode...</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {iframeError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white rounded-lg border border-red-200">
          <div className="flex flex-col items-center gap-4">
            <AlertIcon className="size-12 text-red-400" />
            <p className="text-sm text-red-600">Failed to load OpenCode</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setIframeError(false);
                setIframeLoading(true);
              }}
            >
              Try Again
            </Button>
          </div>
        </div>
      )}

      {/* OpenCode iframe */}
      <iframe
        src={proxyUrl}
        title="OpenCode Development Environment"
        className={cn(
          'h-full w-full rounded-lg border border-neutral-200',
          (iframeLoading || iframeError) && 'invisible'
        )}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
      />
    </div>
  );
}

function ContainerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 7.5V15.5C22 18.5 21 20 17 20H7C3 20 2 18.5 2 15.5V7.5C2 4.5 3 3 7 3H17C21 3 22 4.5 22 7.5Z" />
      <path d="M2 13H22" />
      <path d="M8 7V10" />
      <path d="M12 7V10" />
      <path d="M16 7V10" />
    </svg>
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

function AlertIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}
