import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { EditorDrawer } from '@/components/session/editor-drawer';
import { FilesDrawer } from '@/components/session/files-drawer';
import { SessionMetadataSidebar } from '@/components/session/session-metadata-sidebar';
import type { LogEntry } from '@/hooks/use-chat';

type DrawerPanel = 'editor' | 'files' | null;

const DRAWER_STORAGE_KEY = 'agent-ops:drawer-panel';
const LAYOUT_STORAGE_KEY = 'agent-ops:editor-layout';
const SIDEBAR_STORAGE_KEY = 'agent-ops:metadata-sidebar';

function loadDrawerState(): DrawerPanel {
  try {
    const val = localStorage.getItem(DRAWER_STORAGE_KEY);
    if (val === 'editor' || val === 'files') return val;
  } catch {
    // ignore
  }
  return null;
}

function saveDrawerState(panel: DrawerPanel) {
  try {
    if (panel) {
      localStorage.setItem(DRAWER_STORAGE_KEY, panel);
    } else {
      localStorage.removeItem(DRAWER_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

function loadSavedLayout(): Record<string, number> | undefined {
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

function saveLayout(layout: Record<string, number>) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

export type SessionOverlay =
  | { type: 'transition'; message: string }
  | null;

export interface DrawerContextValue {
  activePanel: DrawerPanel;
  openEditor: () => void;
  openFiles: () => void;
  closeDrawer: () => void;
  toggleEditor: () => void;
  toggleFiles: () => void;
  logEntries: LogEntry[];
  setLogEntries: (entries: LogEntry[]) => void;
  overlay: SessionOverlay;
  setOverlay: (overlay: SessionOverlay) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  connectedUsers: string[];
  setConnectedUsers: (users: string[]) => void;
  selectedModel: string | undefined;
  setSelectedModel: (model: string | undefined) => void;
}

const DrawerCtx = createContext<DrawerContextValue>({
  activePanel: null,
  openEditor: () => {},
  openFiles: () => {},
  closeDrawer: () => {},
  toggleEditor: () => {},
  toggleFiles: () => {},
  logEntries: [],
  setLogEntries: () => {},
  overlay: null,
  setOverlay: () => {},
  sidebarOpen: true,
  toggleSidebar: () => {},
  connectedUsers: [],
  setConnectedUsers: () => {},
  selectedModel: undefined,
  setSelectedModel: () => {},
});

export function useDrawer() {
  return useContext(DrawerCtx);
}

export const Route = createFileRoute('/sessions/$sessionId')({
  component: SessionLayout,
});

function SessionLayout() {
  const { sessionId } = Route.useParams();
  const [activePanel, setActivePanel] = useState<DrawerPanel>(loadDrawerState);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [overlay, setOverlay] = useState<SessionOverlay>(null);
  const [connectedUsers, setConnectedUsers] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    try {
      const val = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      return val !== 'false'; // default open
    } catch { return true; }
  });

  const openEditor = useCallback(() => {
    setActivePanel('editor');
    saveDrawerState('editor');
  }, []);

  const openFiles = useCallback(() => {
    setActivePanel('files');
    saveDrawerState('files');
  }, []);

  const closeDrawer = useCallback(() => {
    setActivePanel(null);
    saveDrawerState(null);
  }, []);

  const toggleEditor = useCallback(() => {
    setActivePanel((prev) => {
      const next = prev === 'editor' ? null : 'editor';
      saveDrawerState(next);
      return next;
    });
  }, []);

  const toggleFiles = useCallback(() => {
    setActivePanel((prev) => {
      const next = prev === 'files' ? null : 'files';
      saveDrawerState(next);
      return next;
    });
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Auto-close sidebar when editor/files panel opens
  const prevActivePanel = useRef(activePanel);
  useEffect(() => {
    if (prevActivePanel.current === null && activePanel !== null && sidebarOpen) {
      setSidebarOpen(false);
      try { localStorage.setItem(SIDEBAR_STORAGE_KEY, 'false'); } catch { /* ignore */ }
    }
    prevActivePanel.current = activePanel;
  }, [activePanel]);

  const ctx: DrawerContextValue = {
    activePanel,
    openEditor,
    openFiles,
    closeDrawer,
    toggleEditor,
    toggleFiles,
    logEntries,
    setLogEntries,
    overlay,
    setOverlay,
    sidebarOpen,
    toggleSidebar,
    connectedUsers,
    setConnectedUsers,
    selectedModel,
    setSelectedModel,
  };

  const defaultLayout = loadSavedLayout();
  const isOpen = activePanel !== null;

  return (
    <DrawerCtx.Provider value={ctx}>
      <div className="relative h-full">
        {isOpen ? (
          <PanelGroup
            orientation="horizontal"
            defaultLayout={defaultLayout}
            onLayoutChanged={saveLayout}
            className="h-full"
          >
            <Panel defaultSize={25} minSize={20} className="!overflow-hidden">
              <div className="flex h-full w-full overflow-hidden">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <Outlet />
                </div>
                {sidebarOpen && (
                  <SessionMetadataSidebar sessionId={sessionId} connectedUsers={connectedUsers} selectedModel={selectedModel} compact />
                )}
              </div>
            </Panel>
            <PanelResizeHandle className="group relative w-px bg-neutral-200 transition-colors hover:bg-accent/40 active:bg-accent dark:bg-neutral-800 dark:hover:bg-accent/40">
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </PanelResizeHandle>
            <Panel defaultSize={75} minSize={30}>
              {activePanel === 'editor' && (
                <EditorDrawer sessionId={sessionId} logEntries={logEntries} />
              )}
              {activePanel === 'files' && (
                <FilesDrawer sessionId={sessionId} />
              )}
            </Panel>
          </PanelGroup>
        ) : (
          <div className="flex h-full">
            <div className="flex-1 min-w-0">
              <Outlet />
            </div>
            {sidebarOpen && (
              <SessionMetadataSidebar sessionId={sessionId} />
            )}
          </div>
        )}

        {/* Full-viewport overlay for hibernate transitions */}
        {overlay?.type === 'transition' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-0/70 dark:bg-surface-0/80 backdrop-blur-[2px]">
            <div className="flex items-center gap-2.5 rounded-lg border border-neutral-200 bg-surface-0 px-4 py-2.5 shadow-sm dark:border-neutral-700 dark:bg-surface-1">
              <LoaderIcon className="h-4 w-4 animate-spin text-neutral-500" />
              <span className="font-mono text-[12px] text-neutral-600 dark:text-neutral-400">
                {overlay.message}
              </span>
            </div>
          </div>
        )}
      </div>
    </DrawerCtx.Provider>
  );
}

function LoaderIcon({ className }: { className?: string }) {
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
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}
