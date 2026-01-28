import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useSession, useSessionToken } from '@/api/sessions';
import { useChat } from '@/hooks/use-chat';
import { MessageList } from '@/components/chat/message-list';
import { ChatInput } from '@/components/chat/chat-input';
import { QuestionPrompt } from '@/components/chat/question-prompt';
import { VSCodePanel, VNCPanel, TerminalPanel } from '@/components/panels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

interface SessionEditorProps {
  sessionId: string;
}

type EditorTab = 'vscode' | 'desktop' | 'terminal';

const LAYOUT_STORAGE_KEY = 'agent-ops:editor-layout';

function loadSavedLayout(): number[] | undefined {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length === 2) return parsed;
    }
  } catch {
    // ignore
  }
  return undefined;
}

function saveLayout(sizes: number[]) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(sizes));
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

  const savedLayout = loadSavedLayout();

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
    <div className="flex h-full flex-col">
      {/* Header bar */}
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="flex items-center gap-3">
          <Link to="/sessions/$sessionId" params={{ sessionId }}>
            <Button variant="ghost" size="sm">
              <ArrowLeftIcon className="mr-1 h-4 w-4" />
              Chat
            </Button>
          </Link>
          <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            Session {sessionId.slice(0, 8)}...
          </span>
          <SessionStatusBadge status={sessionStatus} />
        </div>
        <div className="flex items-center gap-2">
          <Link to="/sessions/$sessionId/files" params={{ sessionId }}>
            <Button variant="ghost" size="sm">Files</Button>
          </Link>
          <ConnectionBadge status={connectionStatus} />
        </div>
      </header>

      {/* Resizable panels */}
      <PanelGroup
        direction="horizontal"
        onLayout={saveLayout}
        className="flex-1"
      >
        {/* Left: Chat */}
        <Panel
          defaultSize={savedLayout?.[0] ?? 35}
          minSize={20}
          order={1}
        >
          <div className="flex h-full flex-col">
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

        <PanelResizeHandle className="w-1.5 bg-neutral-200 transition-colors hover:bg-neutral-400 active:bg-neutral-500 dark:bg-neutral-700 dark:hover:bg-neutral-500" />

        {/* Right: Tabbed environment panels */}
        <Panel
          defaultSize={savedLayout?.[1] ?? 65}
          minSize={30}
          order={2}
        >
          <div className="flex h-full flex-col">
            {/* Tab bar */}
            <div className="flex items-center gap-1 border-b border-neutral-200 bg-neutral-50 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-850">
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
        'flex items-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200'
      )}
    >
      {children}
      {shortcut && (
        <kbd className="hidden text-[10px] opacity-40 sm:inline">{'\u2318'}{shortcut}</kbd>
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
  return <Badge variant={variants[status] ?? 'default'}>{status}</Badge>;
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

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}
