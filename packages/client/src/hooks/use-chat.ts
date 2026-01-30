import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket } from './use-websocket';
import { sessionKeys } from '@/api/sessions';
import type { Message, SessionStatus } from '@/api/types';

export interface PendingQuestion {
  questionId: string;
  text: string;
  options?: string[];
  expiresAt?: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: string;
  summary: string;
}

const MAX_LOG_ENTRIES = 500;

type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

export interface ProviderModels {
  provider: string;
  models: { id: string; name: string }[];
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  diff?: string;
}

interface ChatState {
  messages: Message[];
  status: SessionStatus;
  streamingContent: string;
  pendingQuestions: PendingQuestion[];
  connectedUsers: string[];
  logEntries: LogEntry[];
  isAgentThinking: boolean;
  agentStatus: AgentStatus;
  agentStatusDetail?: string;
  availableModels: ProviderModels[];
  diffData: DiffFile[] | null;
  diffLoading: boolean;
}

interface WebSocketInitMessage {
  type: 'init';
  session: {
    id: string;
    status: SessionStatus;
    workspace: string;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      parts?: unknown;
      createdAt: number;
    }>;
  };
  data?: {
    connectedUsers?: string[];
    [key: string]: unknown;
  };
}

interface WebSocketMessageMessage {
  type: 'message';
  data: {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    parts?: unknown;
    createdAt: number;
  };
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

interface WebSocketAgentStatusMessage {
  type: 'agentStatus';
  status: 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';
  detail?: string;
}

interface WebSocketMessageUpdatedMessage {
  type: 'message.updated';
  data: {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    parts?: unknown;
    createdAt: number;
  };
}

interface WebSocketErrorMessage {
  type: 'error';
  messageId: string;
  error?: string;
  content?: string;
}

interface WebSocketModelsMessage {
  type: 'models';
  models: ProviderModels[];
}

interface WebSocketMessagesRemovedMessage {
  type: 'messages.removed';
  messageIds: string[];
}

interface WebSocketDiffMessage {
  type: 'diff';
  requestId: string;
  data: { files: DiffFile[] };
}

type WebSocketChatMessage =
  | WebSocketInitMessage
  | WebSocketMessageMessage
  | WebSocketMessageUpdatedMessage
  | WebSocketStatusMessage
  | WebSocketChunkMessage
  | WebSocketQuestionMessage
  | WebSocketAgentStatusMessage
  | WebSocketErrorMessage
  | WebSocketModelsMessage
  | WebSocketMessagesRemovedMessage
  | WebSocketDiffMessage
  | { type: 'pong' }
  | { type: 'user.joined'; userId: string }
  | { type: 'user.left'; userId: string };

export function useChat(sessionId: string) {
  const queryClient = useQueryClient();

  const [state, setState] = useState<ChatState>({
    messages: [],
    status: 'initializing',
    streamingContent: '',
    pendingQuestions: [],
    connectedUsers: [],
    logEntries: [],
    isAgentThinking: false,
    agentStatus: 'idle',
    agentStatusDetail: undefined,
    availableModels: [],
    diffData: null,
    diffLoading: false,
  });

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    try {
      return localStorage.getItem(`agent-ops:model:${sessionId}`) || '';
    } catch {
      return '';
    }
  });

  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    try {
      if (model) {
        localStorage.setItem(`agent-ops:model:${sessionId}`, model);
      } else {
        localStorage.removeItem(`agent-ops:model:${sessionId}`);
      }
    } catch {
      // ignore
    }
  }, [sessionId]);

  // Auto-select an Anthropic model when models arrive and nothing is persisted
  const autoSelectModel = useCallback((models: ProviderModels[]) => {
    // Only auto-select if user hasn't already chosen a model
    try {
      if (localStorage.getItem(`agent-ops:model:${sessionId}`)) return;
    } catch { /* ignore */ }

    const anthropic = models.find((p) => p.provider.toLowerCase().includes('anthropic'));
    if (anthropic && anthropic.models.length > 0) {
      const defaultModel =
        anthropic.models.find((m) => m.id.includes('claude-sonnet-4-5')) ||
        anthropic.models.find((m) => m.id.includes('sonnet')) ||
        anthropic.models[0];
      handleModelChange(defaultModel.id);
    }
  }, [sessionId, handleModelChange]);

  const wsUrl = sessionId ? `/api/sessions/${sessionId}/ws?role=client` : null;

  const logIdRef = useRef(0);

  const appendLogEntry = useCallback((type: string, summary: string) => {
    const entry: LogEntry = {
      id: String(++logIdRef.current),
      timestamp: Date.now(),
      type,
      summary,
    };
    setState((prev) => ({
      ...prev,
      logEntries: [...prev.logEntries.slice(-MAX_LOG_ENTRIES + 1), entry],
    }));
  }, []);

  const handleMessage = useCallback((msg: { type: string; [key: string]: unknown }) => {
    const message = msg as WebSocketChatMessage;

    switch (message.type) {
      case 'init': {
        const initModels = Array.isArray(message.data?.availableModels) ? message.data.availableModels as ProviderModels[] : [];
        setState({
          messages: message.session.messages.map((m) => ({
            id: m.id,
            sessionId,
            role: m.role,
            content: m.content,
            parts: m.parts,
            createdAt: new Date(m.createdAt * 1000),
          })),
          status: message.session.status,
          streamingContent: '',
          pendingQuestions: [],
          connectedUsers: Array.isArray(message.data?.connectedUsers) ? message.data.connectedUsers : [],
          logEntries: [],
          isAgentThinking: false,
          agentStatus: 'idle',
          agentStatusDetail: undefined,
          availableModels: initModels,
          diffData: null,
          diffLoading: false,
        });
        if (initModels.length > 0) autoSelectModel(initModels);
        appendLogEntry('init', `Session ${message.session.id.slice(0, 8)} initialized (${message.session.status})`);
        break;
      }

      case 'message': {
        const d = message.data;
        const msg: Message = {
          id: d.id,
          sessionId,
          role: d.role,
          content: d.content,
          parts: d.parts,
          createdAt: new Date(d.createdAt * 1000),
        };
        setState((prev) => {
          const newMessages = [...prev.messages];
          let newStreamingContent = prev.streamingContent;

          // When a tool message arrives while we have streaming content,
          // flush the accumulated text as an intermediate assistant message
          // so that text and tool calls appear in the order they were received.
          if (d.role === 'tool' && prev.streamingContent.trim()) {
            newMessages.push({
              id: `streaming-${Date.now()}`,
              sessionId,
              role: 'assistant',
              content: prev.streamingContent,
              createdAt: new Date(),
            });
            newStreamingContent = '';
          }

          newMessages.push(msg);

          return {
            ...prev,
            messages: newMessages,
            streamingContent: d.role === 'assistant' ? '' : newStreamingContent,
            // Stop thinking when assistant responds; reset status after tool results
            isAgentThinking: d.role === 'assistant' ? false : prev.isAgentThinking,
            ...(d.role === 'tool'
              ? { agentStatus: 'thinking' as const, agentStatusDetail: undefined }
              : {}),
          };
        });
        appendLogEntry('message', `${d.role}: ${d.content.slice(0, 80)}${d.content.length > 80 ? '...' : ''}`);
        break;
      }

      case 'message.updated': {
        const u = (message as WebSocketMessageUpdatedMessage).data;
        setState((prev) => ({
          ...prev,
          messages: prev.messages.map((m) =>
            m.id === u.id
              ? { ...m, content: u.content, parts: u.parts }
              : m
          ),
        }));
        break;
      }

      case 'status': {
        const data = message.data ?? {};
        const newStatus = message.status
          ?? (typeof data.status === 'string' ? data.status as SessionStatus : undefined);
        setState((prev) => {
          let nextQuestions = prev.pendingQuestions;
          let nextUsers = prev.connectedUsers;

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
          // Update connected users list if provided
          if (Array.isArray(data.connectedUsers)) {
            nextUsers = data.connectedUsers as string[];
          }

          return {
            ...prev,
            status: newStatus ?? prev.status,
            pendingQuestions: nextQuestions,
            connectedUsers: nextUsers,
          };
        });
        appendLogEntry('status', newStatus ? `Status changed to ${newStatus}` : 'Status update');
        break;
      }

      case 'chunk':
        setState((prev) => {
          // Ignore trailing chunks after abort (agent is idle)
          if (prev.agentStatus === 'idle') return prev;
          return {
            ...prev,
            streamingContent: prev.streamingContent + message.content,
            // Stop thinking when streaming starts
            isAgentThinking: false,
          };
        });
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
        appendLogEntry('question', message.text.slice(0, 80));
        break;

      case 'agentStatus': {
        const statusMsg = message as WebSocketAgentStatusMessage;
        setState((prev) => ({
          ...prev,
          agentStatus: statusMsg.status,
          agentStatusDetail: statusMsg.detail,
          // Also update isAgentThinking for backward compatibility
          isAgentThinking: statusMsg.status !== 'idle',
        }));
        appendLogEntry('agentStatus', `${statusMsg.status}${statusMsg.detail ? `: ${statusMsg.detail}` : ''}`);
        break;
      }

      case 'error': {
        const errorMsg = message as WebSocketErrorMessage;
        const rawError = errorMsg.error || errorMsg.content || 'Unknown error';
        // Guard against object-type errors that slipped through serialization
        const errorText = typeof rawError === 'string' ? rawError
          : typeof rawError === 'object' ? (rawError as Record<string, unknown>).message as string || JSON.stringify(rawError)
          : String(rawError);
        const errorMessage: Message = {
          id: errorMsg.messageId || crypto.randomUUID(),
          sessionId,
          role: 'system',
          content: `Error: ${errorText}`,
          createdAt: new Date(),
        };
        setState((prev) => ({
          ...prev,
          messages: [...prev.messages, errorMessage],
          streamingContent: '',
          isAgentThinking: false,
          agentStatus: 'error',
          agentStatusDetail: errorText,
        }));
        appendLogEntry('error', errorText.slice(0, 80));
        break;
      }

      case 'models': {
        const modelsMsg = message as WebSocketModelsMessage;
        setState((prev) => ({
          ...prev,
          availableModels: modelsMsg.models,
        }));
        autoSelectModel(modelsMsg.models);
        appendLogEntry('models', `Received ${modelsMsg.models.reduce((n, p) => n + p.models.length, 0)} models`);
        break;
      }

      case 'messages.removed': {
        const removedMsg = message as WebSocketMessagesRemovedMessage;
        const removedSet = new Set(removedMsg.messageIds);
        setState((prev) => ({
          ...prev,
          messages: prev.messages.filter((m) => !removedSet.has(m.id)),
        }));
        appendLogEntry('revert', `Removed ${removedMsg.messageIds.length} messages`);
        break;
      }

      case 'diff': {
        const diffMsg = message as WebSocketDiffMessage;
        setState((prev) => ({
          ...prev,
          diffData: diffMsg.data.files,
          diffLoading: false,
        }));
        appendLogEntry('diff', `Received diff with ${diffMsg.data.files.length} files`);
        break;
      }

      case 'pong':
        break;

      case 'user.joined':
      case 'user.left': {
        // These messages include connectedUsers array
        const userMsg = msg as { connectedUsers?: string[]; userId?: string };
        if (Array.isArray(userMsg.connectedUsers)) {
          setState((prev) => ({
            ...prev,
            connectedUsers: userMsg.connectedUsers as string[],
          }));
        }
        appendLogEntry(message.type, `User ${userMsg.userId ?? 'unknown'} ${message.type === 'user.joined' ? 'joined' : 'left'}`);
        break;
      }
    }
  }, []);

  const { status: wsStatus, send, isConnected } = useWebSocket(wsUrl, {
    onMessage: handleMessage,
  });

  const sendMessage = useCallback(
    (content: string, model?: string) => {
      if (!isConnected) return;

      send({ type: 'prompt', content, ...(model ? { model } : {}) });
      // Start thinking indicator when user sends a message
      setState((prev) => ({ ...prev, isAgentThinking: true }));
    },
    [isConnected, send]
  );

  const abort = useCallback(() => {
    if (!isConnected) return;
    send({ type: 'abort' });
    // Optimistically clear streaming state
    setState((prev) => ({
      ...prev,
      streamingContent: '',
      isAgentThinking: false,
      agentStatus: 'idle' as const,
      agentStatusDetail: undefined,
    }));
  }, [isConnected, send]);

  const revertMessage = useCallback(
    (messageId: string) => {
      if (!isConnected) return;
      send({ type: 'revert', messageId });
    },
    [isConnected, send]
  );

  const requestDiff = useCallback(() => {
    if (!isConnected) return;
    setState((prev) => ({ ...prev, diffLoading: true, diffData: null }));
    send({ type: 'diff' });
  }, [isConnected, send]);

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

  // Sync WebSocket session status changes back to React Query cache
  // so that session detail/list views stay fresh without waiting for polling
  const prevStatusRef = useRef<SessionStatus | null>(null);
  useEffect(() => {
    if (state.status && state.status !== prevStatusRef.current) {
      prevStatusRef.current = state.status;
      // Update session detail cache with the new status
      queryClient.setQueryData(
        sessionKeys.detail(sessionId),
        (old: { session: Record<string, unknown>; doStatus: Record<string, unknown> } | undefined) => {
          if (!old) return old;
          return { ...old, session: { ...old.session, status: state.status } };
        }
      );
      // Invalidate session lists so they refetch with the latest status
      queryClient.invalidateQueries({ queryKey: sessionKeys.infinite() });
    }
  }, [state.status, sessionId, queryClient]);

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
    connectedUsers: state.connectedUsers,
    logEntries: state.logEntries,
    isAgentThinking: state.isAgentThinking,
    agentStatus: state.agentStatus,
    agentStatusDetail: state.agentStatusDetail,
    availableModels: state.availableModels,
    selectedModel,
    setSelectedModel: handleModelChange,
    connectionStatus: wsStatus,
    isConnected,
    sendMessage,
    answerQuestion,
    abort,
    revertMessage,
    requestDiff,
    diffData: state.diffData,
    diffLoading: state.diffLoading,
  };
}
