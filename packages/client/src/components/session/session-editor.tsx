import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useSession, useSessionToken } from '@/api/sessions';
import { useChat } from '@/hooks/use-chat';
import { MessageList } from '@/components/chat/message-list';
import { ChatInput } from '@/components/chat/chat-input';
import { QuestionPrompt } from '@/components/chat/question-prompt';
import { VSCodePanel, VNCPanel, TerminalPanel } from '@/components/panels';
import { CollaboratorsBar } from '@/components/session/collaborators-bar';
import { Badge, StatusDot } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface SessionEditorProps {
  sessionId: string;
}

type EditorTab = 'vscode' | 'desktop' | 'terminal';

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
  const { data: tokenData } = useSessionToken(sessionId);
  const {
    messages,
    sessionStatus,
    streamingContent,
    pendingQuestions,
    connectedUsers,
    connectionStatus,
    isConnected,
    sendMessage,
    answerQuestion,
  } = useChat(sessionId);

  const [activeTab, setActiveTab] = useState<EditorTab>('vscode');
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const isLoading = connectionStatus === 'connecting';
  const isDisabled = !isConnected || sessionStatus === 'terminated';
  const gatewayUrl = session?.gatewayUrl;
  const token = tokenData?.token;

  const defaultLayout = loadSavedLayout();

  // Keyboard shortcuts: Cmd+1 = focus chat, Cmd+2/3/4 = switch tab
  useEffect(() => {
    const TABS: EditorTab[] = ['vscode', 'desktop', 'terminal'];

    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;

      const num = parseInt(e.key, 10);
      if (num < 1 || num > 4) return;

      e.preventDefault();
      if (num === 1) {
        chatInputRef.current?.focus();
      } else {
        setActiveTab(TABS[num - 2]);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

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
          <ConnectionBadge status={connectionStatus} />
        </div>
      </header>

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
                shortcut="2"
              >
                VS Code
              </TabButton>
              <TabButton
                active={activeTab === 'desktop'}
                onClick={() => setActiveTab('desktop')}
                shortcut="3"
              >
                Desktop
              </TabButton>
              <TabButton
                active={activeTab === 'terminal'}
                onClick={() => setActiveTab('terminal')}
                shortcut="4"
              >
                Terminal
              </TabButton>
            </div>

            {/* Panel content */}
            <div className="relative flex-1">
              <div className={cn('absolute inset-0', activeTab !== 'vscode' && 'invisible')}>
                <VSCodePanel
                  gatewayUrl={gatewayUrl}
                  token={token}
                  isLoading={sessionLoading}
                  className="h-full w-full"
                />
              </div>
              <div className={cn('absolute inset-0', activeTab !== 'desktop' && 'invisible')}>
                <VNCPanel
                  gatewayUrl={gatewayUrl}
                  token={token}
                  isLoading={sessionLoading}
                  className="h-full w-full"
                />
              </div>
              <div className={cn('absolute inset-0', activeTab !== 'terminal' && 'invisible')}>
                <TerminalPanel
                  gatewayUrl={gatewayUrl}
                  token={token}
                  isLoading={sessionLoading}
                  className="h-full w-full"
                />
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
