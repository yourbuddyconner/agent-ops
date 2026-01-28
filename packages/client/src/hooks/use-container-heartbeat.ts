import { useRef, useCallback, useEffect } from 'react';
import { useContainerHeartbeat as useHeartbeatMutation } from '@/api/containers';
import { useInterval } from './use-interval';
import { useVisibility } from './use-visibility';

interface UseContainerHeartbeatOptions {
  /** The container ID to send heartbeats for */
  containerId: string;
  /** Whether heartbeats should be active (typically when container is running) */
  enabled: boolean;
  /** Interval in milliseconds between heartbeats. Default: 30000 (30 seconds) */
  interval?: number;
}

interface UseContainerHeartbeatResult {
  /** Timestamp of the last successful heartbeat */
  lastHeartbeat: Date | null;
  /** Whether the heartbeat is currently active */
  isActive: boolean;
  /** Manually trigger a heartbeat */
  sendHeartbeat: () => void;
}

/**
 * Hook that automatically sends heartbeats to keep a container active.
 * Only sends heartbeats when:
 * - enabled is true (container is running)
 * - Page is visible (user is actively viewing)
 *
 * This prevents auto-sleep when the user is actively using the container.
 */
export function useContainerHeartbeatInterval({
  containerId,
  enabled,
  interval = 30000,
}: UseContainerHeartbeatOptions): UseContainerHeartbeatResult {
  const { mutate } = useHeartbeatMutation();
  const isVisible = useVisibility();
  const lastHeartbeatRef = useRef<Date | null>(null);
  const isMountedRef = useRef(true);

  const isActive = enabled && isVisible;

  // Track mounted state for cleanup
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const sendHeartbeat = useCallback(() => {
    if (!containerId || !isMountedRef.current) return;

    mutate(containerId, {
      onSuccess: () => {
        if (isMountedRef.current) {
          lastHeartbeatRef.current = new Date();
        }
      },
      onError: (error) => {
        if (isMountedRef.current) {
          console.error('Heartbeat failed:', error);
        }
      },
    });
  }, [containerId, mutate]);

  // Send heartbeats at regular intervals when active
  useInterval(sendHeartbeat, isActive ? interval : null);

  return {
    lastHeartbeat: lastHeartbeatRef.current,
    isActive,
    sendHeartbeat,
  };
}
