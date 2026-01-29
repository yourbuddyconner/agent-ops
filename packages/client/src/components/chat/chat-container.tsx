import { Link } from '@tanstack/react-router';
import { useChat } from '@/hooks/use-chat';
import { useSession } from '@/api/sessions';
import { MessageList } from './message-list';
import { ChatInput } from './chat-input';
import { QuestionPrompt } from './question-prompt';
import { SessionActionsMenu } from '@/components/sessions/session-actions-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface ChatContainerProps {
  sessionId: string;
}

export function ChatContainer({ sessionId }: ChatContainerProps) {
  const { data: session } = useSession(sessionId);
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
    sendMessage,
    answerQuestion,
  } = useChat(sessionId);

  const isLoading = connectionStatus === 'connecting';
  const isDisabled = !isConnected || sessionStatus === 'terminated';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-surface-0 px-3 py-2 dark:border-neutral-800 dark:bg-surface-0">
        <div className="flex items-center gap-2.5">
          <Link to="/sessions">
            <Button variant="ghost" size="sm">
              <BackIcon className="mr-1 h-3.5 w-3.5" />
              Back
            </Button>
          </Link>
          <div className="h-3.5 w-px bg-neutral-200 dark:bg-neutral-700" />
          <span className="font-mono text-[12px] font-medium text-neutral-600 dark:text-neutral-400">
            {sessionId.slice(0, 8)}
          </span>
          <SessionStatusBadge status={sessionStatus} />
        </div>
        <div className="flex items-center gap-1.5">
          <Link to="/sessions/$sessionId/editor" params={{ sessionId }}>
            <Button variant="ghost" size="sm">
              <EditorIcon className="mr-1 h-3.5 w-3.5" />
              Editor
            </Button>
          </Link>
          <Link to="/sessions/$sessionId/files" params={{ sessionId }}>
            <Button variant="ghost" size="sm">
              <FilesIcon className="mr-1 h-3.5 w-3.5" />
              Files
            </Button>
          </Link>
          <ConnectionStatusBadge status={connectionStatus} />
          {session && (
            <SessionActionsMenu
              session={{ id: sessionId, workspace: session.workspace, status: sessionStatus }}
              showOpen={false}
              showEditorLink={true}
            />
          )}
        </div>
      </header>

      {isLoading ? (
        <ChatSkeleton />
      ) : (
        <>
          <MessageList
            messages={messages}
            streamingContent={streamingContent}
            isAgentThinking={isAgentThinking}
            agentStatus={agentStatus}
            agentStatusDetail={agentStatusDetail}
          />
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
            placeholder={
              isDisabled
                ? 'Session is not available'
                : 'Type a message...'
            }
          />
        </>
      )}
    </div>
  );
}

function SessionStatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    'default' | 'success' | 'warning' | 'error' | 'secondary'
  > = {
    initializing: 'warning',
    running: 'success',
    idle: 'default',
    terminated: 'secondary',
    error: 'error',
  };

  return <Badge variant={variants[status] ?? 'default'}>{status}</Badge>;
}

function ConnectionStatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    'default' | 'success' | 'warning' | 'error' | 'secondary'
  > = {
    connecting: 'warning',
    connected: 'success',
    disconnected: 'secondary',
    error: 'error',
  };

  return (
    <Badge variant={variants[status] ?? 'default'}>
      {status === 'connected' ? 'live' : status}
    </Badge>
  );
}

function ChatSkeleton() {
  return (
    <div className="flex-1 p-4">
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
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
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function EditorIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function FilesIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}
