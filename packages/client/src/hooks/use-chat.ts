import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './use-websocket';
import type { Message, SessionStatus } from '@/api/types';

export interface PendingQuestion {
  questionId: string;
  text: string;
  options?: string[];
  expiresAt?: number;
}

interface ChatState {
  messages: Message[];
  status: SessionStatus;
  streamingContent: string;
  pendingQuestions: PendingQuestion[];
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
  status?: SessionStatus;
  data?: Record<string, unknown>;
}

interface WebSocketChunkMessage {
  type: 'chunk';
  content: string;
}

interface WebSocketQuestionMessage {
  type: 'question';
  questionId: string;
  text: string;
  options?: string[];
  expiresAt?: number;
}

type WebSocketChatMessage =
  | WebSocketInitMessage
  | WebSocketMessageMessage
  | WebSocketStatusMessage
  | WebSocketChunkMessage
  | WebSocketQuestionMessage
  | { type: 'pong' }
  | { type: 'user.joined'; userId: string }
  | { type: 'user.left'; userId: string };

export function useChat(sessionId: string) {
  const [state, setState] = useState<ChatState>({
    messages: [],
    status: 'initializing',
    streamingContent: '',
    pendingQuestions: [],
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
          pendingQuestions: [],
        });
        break;

      case 'message':
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, message.message],
          streamingContent: '',
        }));
        break;

      case 'status': {
        const data = message.data ?? {};
        setState((prev) => {
          let nextQuestions = prev.pendingQuestions;

          // Remove answered questions
          if (data.questionAnswered) {
            nextQuestions = nextQuestions.filter(
              (q) => q.questionId !== data.questionAnswered
            );
          }
          // Remove expired questions
          if (data.questionExpired) {
            nextQuestions = nextQuestions.filter(
              (q) => q.questionId !== data.questionExpired
            );
          }

          return {
            ...prev,
            status: message.status ?? prev.status,
            pendingQuestions: nextQuestions,
          };
        });
        break;
      }

      case 'chunk':
        setState((prev) => ({
          ...prev,
          streamingContent: prev.streamingContent + message.content,
        }));
        break;

      case 'question':
        setState((prev) => ({
          ...prev,
          pendingQuestions: [
            ...prev.pendingQuestions,
            {
              questionId: message.questionId,
              text: message.text,
              options: message.options,
              expiresAt: message.expiresAt,
            },
          ],
        }));
        break;

      case 'pong':
      case 'user.joined':
      case 'user.left':
        // Handled elsewhere or no action needed
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

  const answerQuestion = useCallback(
    (questionId: string, answer: string | boolean) => {
      if (!isConnected) return;

      send({ type: 'answer', questionId, answer });

      // Optimistically remove from pending
      setState((prev) => ({
        ...prev,
        pendingQuestions: prev.pendingQuestions.filter(
          (q) => q.questionId !== questionId
        ),
      }));
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
    pendingQuestions: state.pendingQuestions,
    connectionStatus: wsStatus,
    isConnected,
    sendMessage,
    answerQuestion,
  };
}
