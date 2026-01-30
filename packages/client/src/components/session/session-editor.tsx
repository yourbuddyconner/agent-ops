import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useSession, useSessionToken } from '@/api/sessions';
import { useChat } from '@/hooks/use-chat';
import { MessageList } from '@/components/chat/message-list';
import { ChatInput } from '@/components/chat/chat-input';
import { QuestionPrompt } from '@/components/chat/question-prompt';
import { VSCodePanel, VNCPanel, TerminalPanel } from '@/components/panels';
import { LogsPanel } from '@/components/panels/logs-panel';
import { CollaboratorsBar } from '@/components/session/collaborators-bar';
import { SessionActionsMenu } from '@/components/sessions/session-actions-menu';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface SessionEditorProps {
  sessionId: string;
}

type EditorTab = 'vscode' | 'desktop' | 'terminal' | 'logs';

type Layout = { [id: string]: number };

const LAYOUT_STORAGE_KEY = 'agent-ops:editor-layout';

function loadSavedLayout(): Layout | undefined {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function saveLayout(layout: Layout) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

export function SessionEditor({ sessionId }: SessionEditorProps) {
  const { data: session, isLoading: sessionLoading } = useSession(sessionId);
  const { data: tokenData, isLoading: tokenLoading, isError: tokenError } = useSessionToken(sessionId);
  const {
    messages,
    sessionStatus,
    streamingContent,
    pendingQuestions,
    connectedUsers,
    connectionStatus,
    isConnected,
    logEntries,
    availableModels,
    selectedModel,
    setSelectedModel,
    sendMessage,
    answerQuestion,
  } = useChat(sessionId);

  const [activeTab, setActiveTab] = useState<EditorTab>('vscode');
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = connectionStatus === 'connecting';
  const isDisabled = !isConnected || sessionStatus === 'terminated';
  // Get gateway URL from session or token response (token response is more reliable)
  const gatewayUrl = tokenData?.tunnelUrls?.gateway || session?.gatewayUrl;
  const token = tokenData?.token;
  // Panels are loading until we have both session and token data
  const panelsLoading = sessionLoading || tokenLoading;

  const defaultLayout = loadSavedLayout();


  return (
    <div className="flex h-full flex-col bg-surface-0 dark:bg-surface-0">
      {/* Header bar */}
      <header className="flex h-11 items-center justify-between border-b border-neutral-200 bg-surface-0 px-3 dark:border-neutral-800 dark:bg-surface-0">
        <div className="flex items-center gap-2.5">
          <Link to="/sessions/$sessionId" params={{ sessionId }}>
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="mr-1 h-3.5 w-3.5" />
              Chat
            </Button>
          </Link>
          <div className="h-3.5 w-px bg-neutral-200 dark:bg-neutral-700" />
          <span className="font-mono text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
            {sessionId.slice(0, 8)}
          </span>
          <SessionStatusBadge status={sessionStatus} />
        </div>
        <div className="flex items-center gap-2.5">
          <CollaboratorsBar
            connectedUsers={connectedUsers.map((id) => ({ id }))}
          />
          <Link to="/sessions/$sessionId/files" params={{ sessionId }}>
            <Button variant="ghost" size="sm">Files</Button>
          </Link>
          {session && (
            <SessionActionsMenu
              session={{ id: sessionId, workspace: session.workspace, status: sessionStatus }}
              showOpen={true}
              showEditorLink={false}
            />
          )}
          <ConnectionBadge status={connectionStatus} />
        </div>
      </header>

      {/* Connection status banners */}
      {connectionStatus === 'disconnected' && sessionStatus !== 'terminated' && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-[11px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          Reconnecting to session...
        </div>
      )}
      {tokenError && session?.status === 'initializing' && (
        <div className="flex items-center gap-2 border-b border-blue-200 bg-blue-50 px-3 py-1.5 font-mono text-[11px] text-blue-800 dark:border-blue-800 dark:bg-blue-950/50 dark:text-blue-300">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
          Sandbox starting up...
        </div>
      )}
      {tokenError && session && session.status !== 'initializing' && session.status !== 'terminated' && (
        <div className="flex items-center gap-2 border-b border-red-200 bg-red-50 px-3 py-1.5 font-mono text-[11px] text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
          Connection lost. Retrying...
        </div>
      )}

      {/* Resizable panels */}
      <PanelGroup
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={saveLayout}
        className="flex-1"
      >
        {/* Left: Chat */}
        <Panel
          defaultSize={35}
          minSize={20}
        >
          <div className="flex h-full flex-col border-r border-neutral-200 dark:border-neutral-800">
            {isLoading ? (
              <ChatSkeleton />
            ) : (
              <>
                <MessageList
                  messages={messages}
                  streamingContent={streamingContent}
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
                  inputRef={chatInputRef}
                  placeholder={
                    isDisabled
                      ? 'Session is not available'
                      : 'Type a message...'
                  }
                  availableModels={availableModels}
                  selectedModel={selectedModel}
                  onModelChange={setSelectedModel}
                />
              </>
            )}
          </div>
        </Panel>

        <PanelResizeHandle className="group relative w-px bg-neutral-200 transition-colors hover:bg-accent/40 active:bg-accent dark:bg-neutral-800 dark:hover:bg-accent/40">
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </PanelResizeHandle>

        {/* Right: Tabbed environment panels */}
        <Panel
          defaultSize={65}
          minSize={30}
        >
          <div className="flex h-full flex-col">
            {/* Tab bar */}
            <div className="flex items-center gap-0.5 border-b border-neutral-200 bg-surface-1 px-2 py-1 dark:border-neutral-800 dark:bg-surface-1">
              <TabButton
                active={activeTab === 'vscode'}
                onClick={() => setActiveTab('vscode')}
                              >
                VS Code
              </TabButton>
              <TabButton
                active={activeTab === 'desktop'}
                onClick={() => setActiveTab('desktop')}
                              >
                Desktop
              </TabButton>
              <TabButton
                active={activeTab === 'terminal'}
                onClick={() => setActiveTab('terminal')}
                              >
                Terminal
              </TabButton>
              <TabButton
                active={activeTab === 'logs'}
                onClick={() => setActiveTab('logs')}
                              >
                Logs
              </TabButton>
            </div>

            {/* Panel content */}
            <div className="relative flex-1">
              <div className={cn('absolute inset-0', activeTab !== 'vscode' && 'invisible')}>
                <VSCodePanel
                  gatewayUrl={gatewayUrl}
                  token={token}
                  isLoading={panelsLoading}
                  className="h-full w-full"
                />
              </div>
              <div className={cn('absolute inset-0', activeTab !== 'desktop' && 'invisible')}>
                <VNCPanel
                  gatewayUrl={gatewayUrl}
                  token={token}
                  isLoading={panelsLoading}
                  className="h-full w-full"
                />
              </div>
              <div className={cn('absolute inset-0', activeTab !== 'terminal' && 'invisible')}>
                <TerminalPanel
                  gatewayUrl={gatewayUrl}
                  token={token}
                  isLoading={panelsLoading}
                  className="h-full w-full"
                />
              </div>
              <div className={cn('absolute inset-0', activeTab !== 'logs' && 'invisible')}>
                <LogsPanel entries={logEntries} className="h-full w-full" />
              </div>
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  shortcut,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] font-medium transition-colors',
        active
          ? 'bg-surface-0 text-neutral-900 shadow-sm dark:bg-surface-2 dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-500 dark:hover:text-neutral-300'
      )}
    >
      {children}
      {shortcut && (
        <kbd className="hidden text-[9px] font-normal opacity-30 sm:inline">{'\u2318'}{shortcut}</kbd>
      )}
    </button>
  );
}

function SessionStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
    initializing: 'warning',
    running: 'success',
    idle: 'default',
    terminated: 'secondary',
    error: 'error',
  };
  return (
    <Badge variant={variants[status] ?? 'default'}>
      <StatusDot variant={variants[status] ?? 'default'} />
      {status}
    </Badge>
  );
}

function ConnectionBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
    connecting: 'warning',
    connected: 'success',
    disconnected: 'secondary',
    error: 'error',
  };
  return (
    <Badge variant={variants[status] ?? 'default'}>
      <StatusDot variant={variants[status] ?? 'default'} />
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
            <Skeleton className="h-6 w-6 rounded" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
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
