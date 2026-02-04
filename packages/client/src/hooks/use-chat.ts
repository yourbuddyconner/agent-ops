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

export interface ChildSessionEvent {
  childSessionId: string;
  title?: string;
  timestamp: number;
}

export interface ConnectedUser {
  id: string;
  name?: string;
  email?: string;
  avatarUrl?: string;
}

export interface ReviewResultData {
  files: Array<{
    path: string;
    summary: string;
    reviewOrder: number;
    findings: Array<{
      id: string;
      file: string;
      lineStart: number;
      lineEnd: number;
      severity: 'critical' | 'warning' | 'suggestion' | 'nitpick';
      category: string;
      title: string;
      description: string;
      suggestedFix?: string;
    }>;
    linesAdded: number;
    linesDeleted: number;
  }>;
  overallSummary: string;
  stats: { critical: number; warning: number; suggestion: number; nitpick: number };
}

interface ChatState {
  messages: Message[];
  status: SessionStatus;
  streamingContent: string;
  pendingQuestions: PendingQuestion[];
  connectedUsers: ConnectedUser[];
  logEntries: LogEntry[];
  isAgentThinking: boolean;
  agentStatus: AgentStatus;
  agentStatusDetail?: string;
  availableModels: ProviderModels[];
  diffData: DiffFile[] | null;
  diffLoading: boolean;
  runnerConnected: boolean;
  sessionTitle?: string;
  childSessionEvents: ChildSessionEvent[];
  reviewResult: ReviewResultData | null;
  reviewError: string | null;
  reviewLoading: boolean;
  reviewDiffFiles: DiffFile[] | null;
}

interface WebSocketInitMessage {
  type: 'init';
  session: {
    id: string;
    status: SessionStatus;
    workspace: string;
    title?: string;
    messages: Array<{
      id: string;
      role: 'user' | 'assistant' | 'system' | 'tool';
      content: string;
      parts?: unknown;
      authorId?: string;
      authorEmail?: string;
      authorName?: string;
      authorAvatarUrl?: string;
      createdAt: number;
    }>;
  };
  data?: {
    connectedUsers?: Array<{ id: string; name?: string; email?: string; avatarUrl?: string }> | string[];
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
    authorId?: string;
    authorEmail?: string;
    authorName?: string;
    authorAvatarUrl?: string;
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

interface WebSocketGitStateMessage {
  type: 'git-state';
  data: {
    branch?: string;
    baseBranch?: string;
    commitCount?: number;
  };
}

interface WebSocketPrCreatedMessage {
  type: 'pr-created';
  data: {
    number: number;
    title: string;
    url: string;
    state: string;
  };
}

interface WebSocketFilesChangedMessage {
  type: 'files-changed';
  files: Array<{ path: string; status: string; additions?: number; deletions?: number }>;
}

interface WebSocketChildSessionMessage {
  type: 'child-session';
  childSessionId: string;
  title?: string;
}

interface WebSocketReviewResultMessage {
  type: 'review-result';
  requestId: string;
  data?: ReviewResultData;
  diffFiles?: DiffFile[];
  error?: string;
}

interface WebSocketTitleMessage {
  type: 'title';
  title: string;
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
  | WebSocketGitStateMessage
  | WebSocketPrCreatedMessage
  | WebSocketFilesChangedMessage
  | WebSocketChildSessionMessage
  | WebSocketReviewResultMessage
  | WebSocketTitleMessage
  | { type: 'pong' }
  | { type: 'user.joined'; userId: string }
  | { type: 'user.left'; userId: string };

export function useChat(sessionId: string) {
  const queryClient = useQueryClient();

  // Keep a ref to sessionId so WebSocket message handlers always read the current value
  // without needing sessionId in their dependency arrays (which would cause reconnects).
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const initialState: ChatState = {
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
    runnerConnected: false,
    sessionTitle: undefined,
    childSessionEvents: [],
    reviewResult: null,
    reviewError: null,
    reviewLoading: false,
    reviewDiffFiles: null,
  };

  const [state, setState] = useState<ChatState>(initialState);

  // Reset state when sessionId changes (e.g. navigating between parent/child sessions).
  // Without this, stale messages from the previous session remain visible until the
  // new WebSocket init message arrives.
  const prevSessionIdRef = useRef(sessionId);
  if (prevSessionIdRef.current !== sessionId) {
    prevSessionIdRef.current = sessionId;
    setState(initialState);
  }

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

        // Reconstruct child session events from stored spawn_session tool calls
        const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
        const restoredChildEvents: ChildSessionEvent[] = [];
        for (const m of message.session.messages) {
          if (m.role === 'tool' && m.parts && typeof m.parts === 'object') {
            const p = m.parts as Record<string, unknown>;
            if (typeof p.toolName === 'string' && p.toolName === 'spawn_session' && typeof p.result === 'string') {
              const match = p.result.match(/Child session spawned:\s*(\S+)/) || p.result.match(UUID_RE);
              const childId = match ? (match[1] || match[0]) : null;
              if (childId) {
                const args = (p.args ?? {}) as Record<string, unknown>;
                restoredChildEvents.push({
                  childSessionId: childId,
                  title: (args.title as string) || (args.workspace as string) || undefined,
                  timestamp: m.createdAt * 1000,
                });
              }
            }
          }
        }

        // Normalize connectedUsers — may be string[] (legacy) or ConnectedUser[]
        const rawUsers = message.data?.connectedUsers;
        const normalizedUsers: ConnectedUser[] = Array.isArray(rawUsers)
          ? rawUsers.map((u: string | ConnectedUser) =>
              typeof u === 'string' ? { id: u } : u
            )
          : [];

        setState({
          messages: message.session.messages.map((m) => ({
            id: m.id,
            sessionId: sessionIdRef.current,
            role: m.role,
            content: m.content,
            parts: m.parts,
            authorId: m.authorId,
            authorEmail: m.authorEmail,
            authorName: m.authorName,
            authorAvatarUrl: m.authorAvatarUrl,
            createdAt: new Date(m.createdAt * 1000),
          })),
          status: message.session.status,
          streamingContent: '',
          pendingQuestions: [],
          connectedUsers: normalizedUsers,
          logEntries: [],
          isAgentThinking: false,
          agentStatus: 'idle',
          agentStatusDetail: undefined,
          availableModels: initModels,
          diffData: null,
          diffLoading: false,
          runnerConnected: !!message.data?.runnerConnected,
          sessionTitle: message.session.title,
          childSessionEvents: restoredChildEvents,
          reviewResult: null,
          reviewError: null,
          reviewLoading: false,
          reviewDiffFiles: null,
        });
        if (initModels.length > 0) autoSelectModel(initModels);
        appendLogEntry('init', `Session ${message.session.id.slice(0, 8)} initialized (${message.session.status})`);
        break;
      }

      case 'message': {
        const d = message.data;
        const msg: Message = {
          id: d.id,
          sessionId: sessionIdRef.current,
          role: d.role,
          content: d.content,
          parts: d.parts,
          authorId: d.authorId,
          authorEmail: d.authorEmail,
          authorName: d.authorName,
          authorAvatarUrl: d.authorAvatarUrl,
          createdAt: new Date(d.createdAt * 1000),
        };
        setState((prev) => {
          const newMessages = [...prev.messages];
          newMessages.push(msg);

          return {
            ...prev,
            messages: newMessages,
            // Clear streaming content when an assistant message arrives
            // (the text is now persisted as a stored message segment)
            streamingContent: d.role === 'assistant' ? '' : prev.streamingContent,
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
            nextUsers = (data.connectedUsers as Array<string | ConnectedUser>).map(
              (u: string | ConnectedUser) => typeof u === 'string' ? { id: u } : u
            );
          }

          // Track runner connection state
          const runnerConnected = typeof data.runnerConnected === 'boolean'
            ? data.runnerConnected
            : prev.runnerConnected;

          return {
            ...prev,
            status: newStatus ?? prev.status,
            pendingQuestions: nextQuestions,
            connectedUsers: nextUsers,
            runnerConnected,
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
          sessionId: sessionIdRef.current,
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

      case 'git-state': {
        const gitMsg = message as WebSocketGitStateMessage;
        // Update the git-state query cache with real-time data
        queryClient.setQueryData(
          sessionKeys.gitState(sessionIdRef.current),
          (old: { gitState: Record<string, unknown> | null } | undefined) => {
            const prev = old?.gitState ?? {};
            return {
              gitState: {
                ...prev,
                ...(gitMsg.data.branch !== undefined ? { branch: gitMsg.data.branch } : {}),
                ...(gitMsg.data.baseBranch !== undefined ? { baseBranch: gitMsg.data.baseBranch } : {}),
                ...(gitMsg.data.commitCount !== undefined ? { commitCount: gitMsg.data.commitCount } : {}),
              },
            };
          }
        );
        appendLogEntry('git-state', `Branch: ${gitMsg.data.branch ?? '?'}, commits: ${gitMsg.data.commitCount ?? '?'}`);
        break;
      }

      case 'pr-created': {
        const prMsg = message as WebSocketPrCreatedMessage;
        queryClient.setQueryData(
          sessionKeys.gitState(sessionIdRef.current),
          (old: { gitState: Record<string, unknown> | null } | undefined) => {
            const prev = old?.gitState ?? {};
            return {
              gitState: {
                ...prev,
                prNumber: prMsg.data.number,
                prTitle: prMsg.data.title,
                prUrl: prMsg.data.url,
                prState: prMsg.data.state,
              },
            };
          }
        );
        appendLogEntry('pr-created', `PR #${prMsg.data.number}: ${prMsg.data.title}`);
        break;
      }

      case 'files-changed': {
        const filesMsg = message as WebSocketFilesChangedMessage;
        // Update the files-changed query cache with real-time data
        queryClient.invalidateQueries({ queryKey: sessionKeys.filesChanged(sessionIdRef.current) });
        appendLogEntry('files-changed', `${filesMsg.files.length} files changed`);
        break;
      }

      case 'child-session': {
        const childMsg = message as WebSocketChildSessionMessage;
        setState((prev) => ({
          ...prev,
          childSessionEvents: [
            ...prev.childSessionEvents,
            {
              childSessionId: childMsg.childSessionId,
              title: childMsg.title,
              timestamp: Date.now(),
            },
          ],
        }));
        queryClient.invalidateQueries({ queryKey: sessionKeys.children(sessionIdRef.current) });
        appendLogEntry('child-session', `Child session: ${childMsg.title || childMsg.childSessionId.slice(0, 8)}`);
        break;
      }

      case 'title': {
        const titleMsg = message as WebSocketTitleMessage;
        setState((prev) => ({
          ...prev,
          sessionTitle: titleMsg.title,
        }));
        // Update session detail query cache with new title
        queryClient.setQueryData(
          sessionKeys.detail(sessionIdRef.current),
          (old: { session: Record<string, unknown>; doStatus: Record<string, unknown> } | undefined) => {
            if (!old) return old;
            return { ...old, session: { ...old.session, title: titleMsg.title } };
          }
        );
        appendLogEntry('title', `Title: ${titleMsg.title}`);
        break;
      }

      case 'review-result': {
        const reviewMsg = message as WebSocketReviewResultMessage;
        setState((prev) => ({
          ...prev,
          reviewResult: reviewMsg.data ?? null,
          reviewError: reviewMsg.error ?? null,
          reviewLoading: false,
          reviewDiffFiles: reviewMsg.diffFiles ?? null,
        }));
        appendLogEntry('review-result', reviewMsg.error
          ? `Review error: ${reviewMsg.error}`
          : `Review complete: ${reviewMsg.data?.files.length ?? 0} files`);
        break;
      }

      case 'pong':
        break;

      case 'user.joined':
      case 'user.left': {
        // These messages include connectedUsers array (may be enriched objects or string IDs)
        const userMsg = msg as { connectedUsers?: Array<string | ConnectedUser>; userId?: string; userDetails?: { name?: string; email?: string; avatarUrl?: string } };
        if (Array.isArray(userMsg.connectedUsers)) {
          setState((prev) => ({
            ...prev,
            connectedUsers: userMsg.connectedUsers!.map((u: string | ConnectedUser) =>
              typeof u === 'string' ? { id: u } : u
            ),
          }));
        }
        const displayName = userMsg.userDetails?.name || userMsg.userId || 'unknown';
        appendLogEntry(message.type, `${displayName} ${message.type === 'user.joined' ? 'joined' : 'left'}`);
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

  const requestReview = useCallback(() => {
    if (!isConnected) return;
    setState((prev) => ({
      ...prev,
      reviewLoading: true,
      reviewResult: null,
      reviewError: null,
      reviewDiffFiles: null,
    }));
    send({ type: 'review' });
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
    runnerConnected: state.runnerConnected,
    sessionTitle: state.sessionTitle,
    childSessionEvents: state.childSessionEvents,
    requestReview,
    reviewResult: state.reviewResult,
    reviewError: state.reviewError,
    reviewLoading: state.reviewLoading,
    reviewDiffFiles: state.reviewDiffFiles,
  };
}
