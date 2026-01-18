import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './use-websocket';
import type { Message, SessionStatus } from '@/api/types';

interface ChatState {
  messages: Message[];
  status: SessionStatus;
  streamingContent: string;
}

interface WebSocketInitMessage {
  type: 'init';
  session: {
    id: string;
    status: SessionStatus;
    workspace: string;
    messages: Message[];
  };
}

interface WebSocketMessageMessage {
  type: 'message';
  message: Message;
}

interface WebSocketStatusMessage {
  type: 'status';
  status: SessionStatus;
}

interface WebSocketChunkMessage {
  type: 'chunk';
  content: string;
}

type WebSocketChatMessage =
  | WebSocketInitMessage
  | WebSocketMessageMessage
  | WebSocketStatusMessage
  | WebSocketChunkMessage
  | { type: 'pong' };

export function useChat(sessionId: string) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    status: 'initializing',
    streamingContent: '',
  });

  const wsUrl = sessionId ? `/api/sessions/${sessionId}/ws` : null;

  const handleMessage = useCallback((msg: { type: string; [key: string]: unknown }) => {
    const message = msg as WebSocketChatMessage;

    switch (message.type) {
      case 'init':
        setState({
          messages: message.session.messages,
          status: message.session.status,
          streamingContent: '',
        });
        break;

      case 'message':
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, message.message],
          streamingContent: '',
        }));
        break;

      case 'status':
        setState((prev) => ({
          ...prev,
          status: message.status,
        }));
        break;

      case 'chunk':
        setState((prev) => ({
          ...prev,
          streamingContent: prev.streamingContent + message.content,
        }));
        break;

      case 'pong':
        // Heartbeat response, no action needed
        break;
    }
  }, []);

  const { status: wsStatus, send, isConnected } = useWebSocket(wsUrl, {
    onMessage: handleMessage,
  });

  const sendMessage = useCallback(
    (content: string) => {
      if (!isConnected) return;

      send({ type: 'message', content });
    },
    [isConnected, send]
  );

  // Ping to keep connection alive
  useEffect(() => {
    if (!isConnected) return;

    const interval = setInterval(() => {
      send({ type: 'ping' });
    }, 30000);

    return () => clearInterval(interval);
  }, [isConnected, send]);

  return {
    messages: state.messages,
    sessionStatus: state.status,
    streamingContent: state.streamingContent,
    connectionStatus: wsStatus,
    isConnected,
    sendMessage,
  };
}
