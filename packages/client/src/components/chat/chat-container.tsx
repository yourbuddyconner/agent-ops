import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { useChat } from '@/hooks/use-chat';
import { useSession, useSessionGitState, useUpdateSessionTitle, useSessionChildren } from '@/api/sessions';
import { useDrawer } from '@/routes/sessions/$sessionId';
import { MessageList } from './message-list';
import { ChatInput } from './chat-input';
import { QuestionPrompt } from './question-prompt';
import { SessionActionsMenu } from '@/components/sessions/session-actions-menu';
import { ShareSessionDialog } from '@/components/sessions/share-session-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthStore } from '@/stores/auth';

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const { data: session } = useSession(sessionId);
  const { data: gitState } = useSessionGitState(sessionId);
  const { data: childSessions } = useSessionChildren(sessionId);
  const updateTitle = useUpdateSessionTitle();
  const drawer = useDrawer();
  const {
    messages,
    sessionStatus,
    streamingContent,
    pendingQuestions,
    connectionStatus,
    isConnected,
    isAgentThinking,
    agentStatus,
    agentStatusDetail,
    availableModels,
    selectedModel,
    setSelectedModel,
    sendMessage,
    answerQuestion,
    abort,
    revertMessage,
    runnerConnected,
    logEntries,
    sessionTitle,
    childSessionEvents,
    connectedUsers,
  } = useChat(sessionId);

  // Sync log entries to the editor drawer context
  useEffect(() => {
    drawer.setLogEntries(logEntries);
  }, [logEntries, drawer.setLogEntries]);

  // Sync connected users and selected model to layout context for sidebar
  useEffect(() => {
    drawer.setConnectedUsers(connectedUsers);
  }, [connectedUsers, drawer.setConnectedUsers]);

  useEffect(() => {
    drawer.setSelectedModel(selectedModel);
  }, [selectedModel, drawer.setSelectedModel]);


  // Share dialog state
  const [shareOpen, setShareOpen] = useState(false);
  const authUser = useAuthStore((s) => s.user);
  const isOwner = session?.userId === authUser?.id;

  // Editable title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);

  const displayTitle = sessionTitle || session?.title || session?.workspace || sessionId.slice(0, 8);

  const startEditingTitle = useCallback(() => {
    setEditTitleValue(sessionTitle || session?.title || '');
    setIsEditingTitle(true);
    requestAnimationFrame(() => titleInputRef.current?.focus());
  }, [sessionTitle, session?.title]);

  const saveTitle = useCallback(() => {
    const trimmed = editTitleValue.trim();
    if (trimmed && trimmed !== (sessionTitle || session?.title)) {
      updateTitle.mutate({ sessionId, title: trimmed });
    }
    setIsEditingTitle(false);
  }, [editTitleValue, sessionTitle, session?.title, sessionId, updateTitle]);

  // Track whether we've seen a hibernate transition in this page session
  const wasHibernatingRef = useRef(false);
  if (sessionStatus === 'hibernating' || sessionStatus === 'restoring' || sessionStatus === 'hibernated') {
    wasHibernatingRef.current = true;
  }
  if (runnerConnected) {
    wasHibernatingRef.current = false;
  }

  const isLoading = connectionStatus === 'connecting';
  const isTerminated = sessionStatus === 'terminated';
  const isHibernateTransition = sessionStatus === 'hibernating' || sessionStatus === 'restoring';
  const isAwaitingRunner = wasHibernatingRef.current && sessionStatus === 'running' && !runnerConnected;
  const isDisabled = !isConnected || isTerminated;
  const isAgentActive = (isAgentThinking && agentStatus !== 'queued') || agentStatus === 'thinking' || agentStatus === 'tool_calling' || agentStatus === 'streaming';

  // Clear any stale overlay (no longer using layout-level transition overlays)
  useEffect(() => {
    drawer.setOverlay(null);
  }, [drawer.setOverlay]);

  // Global Escape key handler for abort
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isAgentActive) {
        e.preventDefault();
        abort();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAgentActive, abort]);

  return (
    <div className="flex h-full flex-col">
      {/* Header — Title bar */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-surface-0 px-3 dark:bg-surface-0">
        <div className="flex items-center gap-2 min-w-0">
          <Link to="/sessions">
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200">
              <BackIcon className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <div className="h-3 w-px bg-neutral-200 dark:bg-neutral-800" />

          {/* Editable session title */}
          {isEditingTitle ? (
            <input
              ref={titleInputRef}
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') setIsEditingTitle(false);
              }}
              className="min-w-[120px] max-w-[300px] rounded-sm border border-accent/30 bg-transparent px-1.5 py-0.5 font-sans text-[13px] font-semibold text-neutral-900 outline-none selection:bg-accent/20 dark:text-neutral-100"
              placeholder="Session title..."
            />
          ) : (
            <button
              onClick={startEditingTitle}
              className="group flex items-center gap-1.5 truncate rounded-sm px-1 py-0.5 text-[13px] font-semibold text-neutral-900 transition-colors hover:bg-surface-1 dark:text-neutral-100 dark:hover:bg-surface-2"
              title="Click to edit title"
            >
              <span className="truncate">{displayTitle}</span>
              <PencilIcon className="h-2.5 w-2.5 shrink-0 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 dark:text-neutral-600" />
            </button>
          )}

          <SessionStatusBadge
            status={sessionStatus}
            errorMessage={session?.errorMessage}
          />
          <SessionStatusIndicator sessionStatus={sessionStatus} connectionStatus={connectionStatus} />
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShareOpen(true)}
            className="h-6 gap-1 px-1.5 text-neutral-400 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-200"
            title="Share session"
          >
            <ShareIcon className="h-3.5 w-3.5" />
          </Button>
          <ShareSessionDialog
            sessionId={sessionId}
            open={shareOpen}
            onOpenChange={setShareOpen}
            isOwner={isOwner}
          />
          {session && (
            <SessionActionsMenu
              session={{ id: sessionId, workspace: session.workspace, status: sessionStatus }}
              showOpen={false}
              showEditorLink={false}
            />
          )}
        </div>
      </header>

      {/* Action toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 border-b border-neutral-100 bg-surface-0 px-2 dark:border-neutral-800/50 dark:bg-surface-0">
        <Button variant="ghost" size="sm" onClick={drawer.toggleEditor} className="h-6 gap-1 px-2 text-[11px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          <EditorIcon className="h-3 w-3" />
          Editor
        </Button>
        <Button variant="ghost" size="sm" onClick={drawer.toggleFiles} className="h-6 gap-1 px-2 text-[11px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          <FilesIcon className="h-3 w-3" />
          Files
        </Button>
        <Button variant="ghost" size="sm" onClick={drawer.toggleReview} className="h-6 gap-1 px-2 text-[11px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
          <ReviewIcon className="h-3 w-3" />
          Review
        </Button>
        {gitState?.prUrl && (
          <a href={gitState.prUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[11px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200">
              <PRIcon className="h-3 w-3" />
              PR
              {gitState.prState && (
                <Badge
                  variant={
                    gitState.prState === 'merged' ? 'default'
                      : gitState.prState === 'open' ? 'success'
                      : gitState.prState === 'draft' ? 'secondary'
                      : 'error'
                  }
                  className="ml-0.5 text-2xs"
                >
                  {gitState.prState}
                </Badge>
              )}
            </Button>
          </a>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={drawer.toggleSidebar} title="Toggle session info sidebar" className="h-6 px-1.5 text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300">
          <InfoIcon className="h-3 w-3" />
        </Button>
      </div>

      {isLoading ? (
        <ChatSkeleton />
      ) : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <MessageList
              messages={messages}
              streamingContent={streamingContent}
              isAgentThinking={isAgentThinking}
              agentStatus={agentStatus}
              agentStatusDetail={agentStatusDetail}
              onRevert={revertMessage}
              childSessionEvents={childSessionEvents}
              childSessions={childSessions}
              connectedUsers={connectedUsers}
            />
          </div>
          {pendingQuestions.map((q) => (
            <QuestionPrompt
              key={q.questionId}
              questionId={q.questionId}
              text={q.text}
              options={q.options}
              expiresAt={q.expiresAt}
              onAnswer={answerQuestion}
            />
          ))}
          <ChatInput
            onSend={sendMessage}
            disabled={isDisabled}
            sendDisabled={isHibernateTransition || isAwaitingRunner}
            placeholder={
              isDisabled
                ? 'Session is not available'
                : 'Ask or build anything...'
            }
            availableModels={availableModels}
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onAbort={abort}
            isAgentActive={isAgentActive}
            sessionId={sessionId}
            sessionStatus={sessionStatus}
            compact={drawer.activePanel !== null}
          />
        </>
      )}
    </div>
  );
}

function SessionStatusBadge({ status, errorMessage }: { status: string; errorMessage?: string }) {
  const variants: Record<
    string,
    'default' | 'success' | 'warning' | 'error' | 'secondary'
  > = {
    initializing: 'warning',
    running: 'success',
    idle: 'default',
    hibernating: 'warning',
    hibernated: 'secondary',
    restoring: 'warning',
    terminated: 'secondary',
    error: 'error',
  };

  return <Badge variant={variants[status] ?? 'default'} title={errorMessage}>{status}</Badge>;
}

function SessionStatusIndicator({ sessionStatus, connectionStatus }: { sessionStatus: string; connectionStatus: string }) {
  // Determine color and animation based on session state
  const isTransitioning = sessionStatus === 'hibernating' || sessionStatus === 'restoring' || sessionStatus === 'initializing';
  const isRunning = sessionStatus === 'running' || sessionStatus === 'idle';
  const isSleeping = sessionStatus === 'hibernated';
  const isTerminated = sessionStatus === 'terminated';
  const isError = sessionStatus === 'error' || connectionStatus === 'error';
  const isDisconnected = connectionStatus === 'disconnected' || connectionStatus === 'connecting';

  let color = 'bg-neutral-300 dark:bg-neutral-600';
  let title = sessionStatus;
  let pulse = false;
  let spin = false;

  if (isError) {
    color = 'bg-red-400';
    title = 'Error';
  } else if (isTerminated) {
    color = 'bg-neutral-300 dark:bg-neutral-600';
    title = 'Terminated';
  } else if (isTransitioning) {
    color = 'bg-amber-400';
    title = sessionStatus === 'initializing' ? 'Starting...' : sessionStatus === 'hibernating' ? 'Hibernating...' : 'Waking...';
    spin = true;
  } else if (isSleeping) {
    color = 'bg-neutral-400 dark:bg-neutral-500';
    title = 'Hibernated';
    pulse = true;
  } else if (isDisconnected) {
    color = 'bg-amber-400';
    title = 'Reconnecting...';
    spin = true;
  } else if (isRunning) {
    color = 'bg-emerald-500';
    title = 'Live';
    pulse = true;
  }

  return (
    <div className="relative flex items-center justify-center" title={title}>
      <div className={`h-1.5 w-1.5 rounded-full ${color} ${spin ? 'animate-spin-slow' : ''}`} />
      {pulse && !spin && (
        <div
          className={`absolute h-2.5 w-2.5 rounded-full border ${
            isRunning
              ? 'border-emerald-500/30'
              : 'border-neutral-400/20 dark:border-neutral-500/20'
          } animate-ping`}
          style={{ animationDuration: isRunning ? '2s' : '3s' }}
        />
      )}
      {spin && (
        <div className="absolute h-3 w-3">
          <div
            className={`h-full w-full rounded-full border border-transparent ${
              isTransitioning ? 'border-t-amber-400/60' : 'border-t-amber-400/60'
            } animate-spin`}
            style={{ animationDuration: '1s' }}
          />
        </div>
      )}
    </div>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex-1 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-16 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function PencilIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function EditorIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function FilesIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function ReviewIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function PRIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <line x1="6" x2="6" y1="9" y2="21" />
    </svg>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" x2="12" y1="2" y2="15" />
    </svg>
  );
}

