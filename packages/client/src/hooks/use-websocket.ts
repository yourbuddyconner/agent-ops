import { useEffect, useRef, useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/auth';

type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

interface UseWebSocketOptions {
  onMessage?: (message: WebSocketMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
  reconnect?: boolean;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(url: string | null, options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    onError,
    reconnect = true,
    reconnectInterval = 3000,
    maxReconnectAttempts = 5,
  } = options;

  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const user = useAuthStore((state) => state.user);

  const connect = useCallback(() => {
    if (!url || !user) return;

    setStatus('connecting');

    const wsUrl = new URL(url, window.location.origin);
    wsUrl.protocol = wsUrl.protocol.replace('http', 'ws');
    wsUrl.searchParams.set('userId', user.id);

    const ws = new WebSocket(wsUrl.toString());

    ws.onopen = () => {
      setStatus('connected');
      reconnectAttemptsRef.current = 0;
      onConnect?.();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        onMessage?.(message);
      } catch {
        console.error('Failed to parse WebSocket message:', event.data);
      }
    };

    ws.onerror = (event) => {
      setStatus('error');
      onError?.(event);
    };

    ws.onclose = () => {
      setStatus('disconnected');
      wsRef.current = null;
      onDisconnect?.();

      if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, reconnectInterval);
      }
    };

    wsRef.current = ws;
  }, [url, user, onMessage, onConnect, onDisconnect, onError, reconnect, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = maxReconnectAttempts;
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
  }, [maxReconnectAttempts]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    if (url && user) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [url, user, connect, disconnect]);

  return {
    status,
    send,
    connect,
    disconnect,
    isConnected: status === 'connected',
  };
}
