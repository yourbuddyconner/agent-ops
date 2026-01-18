import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/auth';

type SSEStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface UseSSEOptions {
  onMessage?: (data: string) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useSSE(url: string | null, options: UseSSEOptions = {}) {
  const { onMessage, onConnect, onDisconnect, onError } = options;

  const [status, setStatus] = useState<SSEStatus>('disconnected');
  const eventSourceRef = useRef<EventSource | null>(null);
  const token = useAuthStore((state) => state.token);

  const connect = useCallback(() => {
    if (!url) return;

    setStatus('connecting');

    const fullUrl = new URL(url, window.location.origin);
    if (token) {
      fullUrl.searchParams.set('token', token);
    }

    const eventSource = new EventSource(fullUrl.toString());

    eventSource.onopen = () => {
      setStatus('connected');
      onConnect?.();
    };

    eventSource.onmessage = (event) => {
      onMessage?.(event.data);
    };

    eventSource.onerror = (event) => {
      setStatus('error');
      onError?.(event);
      eventSource.close();
      setStatus('disconnected');
      onDisconnect?.();
    };

    eventSourceRef.current = eventSource;
  }, [url, token, onMessage, onConnect, onDisconnect, onError]);

  const disconnect = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setStatus('disconnected');
  }, []);

  useEffect(() => {
    if (url) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [url, connect, disconnect]);

  return {
    status,
    connect,
    disconnect,
    isConnected: status === 'connected',
  };
}
