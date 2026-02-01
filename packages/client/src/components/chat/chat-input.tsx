import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useFileFinder, type FileReadResponse } from '@/api/files';
import { api } from '@/api/client';
import { useWakeSession } from '@/api/sessions';
import type { ProviderModels } from '@/hooks/use-chat';

interface ChatInputProps {
  onSend: (content: string, model?: string) => void;
  disabled?: boolean;
  /** Blocks sending but keeps textarea interactive (e.g. during hibernate transitions) */
  sendDisabled?: boolean;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  availableModels?: ProviderModels[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  onAbort?: () => void;
  isAgentActive?: boolean;
  sessionId?: string;
  sessionStatus?: string;
  /** When true, uses a more compact layout (hides hint text, tighter padding) */
  compact?: boolean;
}

interface FlatModel {
  id: string;
  name: string;
  provider: string;
}

/**
 * Given the current input value and cursor position, find an active @ mention query.
 * Returns { query, startIndex } or null if no active @ context.
 */
function getAtContext(value: string, cursorPos: number): { query: string; startIndex: number } | null {
  // Scan backward from cursor to find the nearest `@`
  const textBeforeCursor = value.slice(0, cursorPos);
  const atIndex = textBeforeCursor.lastIndexOf('@');
  if (atIndex === -1) return null;

  // @ must not be preceded by a word character (i.e., it should be at start or after whitespace/punctuation)
  if (atIndex > 0 && /\w/.test(textBeforeCursor[atIndex - 1])) return null;

  const query = textBeforeCursor.slice(atIndex + 1);

  // Don't trigger if there's a space in the query (user has moved on)
  if (query.includes(' ') || query.includes('\n')) return null;

  return { query, startIndex: atIndex };
}

/**
 * Truncate a file path for display, showing the last few segments.
 */
function truncatePath(path: string, maxLen = 60): string {
  if (path.length <= maxLen) return path;
  const segments = path.split('/');
  let result = segments[segments.length - 1];
  for (let i = segments.length - 2; i >= 0; i--) {
    const next = segments[i] + '/' + result;
    if (next.length > maxLen - 2) {
      return '\u2026/' + result;
    }
    result = next;
  }
  return result;
}

export function ChatInput({
  onSend,
  disabled = false,
  sendDisabled = false,
  placeholder = 'Ask or build anything...',
  inputRef,
  availableModels = [],
  selectedModel = '',
  onModelChange,
  onAbort,
  isAgentActive = false,
  sessionId,
  sessionStatus,
  compact = false,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [modelCommandDismissed, setModelCommandDismissed] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const [fileHighlightIndex, setFileHighlightIndex] = useState(0);
  const [atMenuDismissed, setAtMenuDismissed] = useState(false);
  const [isSendingFiles, setIsSendingFiles] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalRef;
  const overlayRef = useRef<HTMLDivElement>(null);
  const fileOverlayRef = useRef<HTMLDivElement>(null);

  // Wake session on focus if hibernated
  const wakeMutation = useWakeSession();
  const handleFocus = useCallback(() => {
    if (sessionId && sessionStatus === 'hibernated' && !wakeMutation.isPending) {
      wakeMutation.mutate(sessionId);
    }
  }, [sessionId, sessionStatus, wakeMutation.isPending]);

  // Track cursor position on every input change and selection change
  const updateCursorPos = useCallback(() => {
    const pos = textareaRef.current?.selectionStart ?? 0;
    setCursorPos(pos);
  }, [textareaRef]);

  // @ mention detection
  const atContext = useMemo(() => {
    if (atMenuDismissed) return null;
    return getAtContext(value, cursorPos);
  }, [value, cursorPos, atMenuDismissed]);

  const atQuery = atContext?.query ?? '';

  // File finder query
  const { data: fileFinderData, isLoading: fileFinderLoading } = useFileFinder(
    sessionId ?? '',
    atQuery
  );
  const filePaths = fileFinderData?.paths ?? [];

  const showFileOverlay = !!atContext && !!sessionId;

  // Reset file highlight when query changes
  useEffect(() => {
    setFileHighlightIndex(0);
  }, [atQuery]);

  // Reset atMenuDismissed when @ context changes (user types a new @)
  useEffect(() => {
    if (atContext) {
      // Only reset if we have a new context
    } else {
      setAtMenuDismissed(false);
    }
  }, [!atContext]);

  // Flatten all models for easier filtering
  const allModels = useMemo<FlatModel[]>(() => {
    return availableModels.flatMap((p) =>
      p.models.map((m) => ({ id: m.id, name: m.name, provider: p.provider }))
    );
  }, [availableModels]);

  // Detect /model command
  const modelCommandMatch = value.match(/^\/model(?:\s+(.*))?$/i);
  const isModelCommand = !!modelCommandMatch && !modelCommandDismissed;
  const filterText = (modelCommandMatch?.[1] ?? '').toLowerCase().trim();

  // Filter models by search text
  const filteredModels = useMemo(() => {
    if (!isModelCommand) return [];
    if (!filterText) return allModels;
    return allModels.filter(
      (m) =>
        m.name.toLowerCase().includes(filterText) ||
        m.id.toLowerCase().includes(filterText) ||
        m.provider.toLowerCase().includes(filterText)
    );
  }, [isModelCommand, filterText, allModels]);

  // Group filtered models by provider for display
  const groupedFiltered = useMemo(() => {
    const groups: Record<string, FlatModel[]> = {};
    for (const m of filteredModels) {
      (groups[m.provider] ??= []).push(m);
    }
    return Object.entries(groups);
  }, [filteredModels]);

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightIndex(0);
  }, [filterText]);

  // Reset dismissed state when input no longer matches /model
  useEffect(() => {
    if (!modelCommandMatch) {
      setModelCommandDismissed(false);
    }
  }, [!!modelCommandMatch]);

  const selectModel = useCallback(
    (model: FlatModel) => {
      onModelChange?.(model.id);
      setValue('');
      setModelCommandDismissed(false);
      textareaRef.current?.focus();
    },
    [onModelChange, textareaRef]
  );

  const selectFile = useCallback(
    (filePath: string) => {
      if (!atContext) return;
      const before = value.slice(0, atContext.startIndex);
      const after = value.slice(cursorPos);
      const newValue = before + '@' + filePath + ' ' + after;
      setValue(newValue);
      setAtMenuDismissed(false);
      // Set cursor after the inserted file path + space
      const newCursorPos = atContext.startIndex + 1 + filePath.length + 1;
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        if (textarea) {
          textarea.focus();
          textarea.setSelectionRange(newCursorPos, newCursorPos);
          setCursorPos(newCursorPos);
        }
      });
    },
    [atContext, value, cursorPos, textareaRef]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled || sendDisabled || isSendingFiles) return;

    // If input is a /model command, treat as model selection if there's an exact or single match
    if (modelCommandMatch) {
      if (filteredModels.length === 1) {
        selectModel(filteredModels[0]);
        return;
      }
      if (filteredModels.length > 1) {
        selectModel(filteredModels[highlightIndex]);
        return;
      }
      // No matches — don't send as a message
      return;
    }

    const messageText = value.trim();

    // Extract all @path tokens from the message
    const atMentionRegex = /@([\w./\-[\]()]+)/g;
    const mentions = new Set<string>();
    let match;
    while ((match = atMentionRegex.exec(messageText)) !== null) {
      mentions.add(match[1]);
    }

    // If we have file mentions and a sessionId, fetch file contents
    if (mentions.size > 0 && sessionId) {
      setIsSendingFiles(true);
      try {
        const fileContents = await Promise.allSettled(
          Array.from(mentions).map(async (path) => {
            const data = await api.get<FileReadResponse>(
              `/files/read?sessionId=${sessionId}&path=${encodeURIComponent(path)}`
            );
            return { path, content: data.content };
          })
        );

        // Build the prompt with file context blocks
        const contextBlocks = fileContents
          .filter((r): r is PromiseFulfilledResult<{ path: string; content: string }> =>
            r.status === 'fulfilled'
          )
          .map((r) => `<file path="${r.value.path}">\n${r.value.content}\n</file>`)
          .join('\n\n');

        const finalMessage = contextBlocks
          ? contextBlocks + '\n\n' + messageText
          : messageText;

        onSend(finalMessage, selectedModel || undefined);
      } catch {
        // If file fetching fails, send the message as-is
        onSend(messageText, selectedModel || undefined);
      } finally {
        setIsSendingFiles(false);
      }
    } else {
      onSend(messageText, selectedModel || undefined);
    }

    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // File overlay keyboard handling takes priority when showing
    if (showFileOverlay && filePaths.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFileHighlightIndex((i) => (i + 1) % filePaths.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFileHighlightIndex((i) => (i - 1 + filePaths.length) % filePaths.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectFile(filePaths[fileHighlightIndex]);
        return;
      }
    }

    if (showFileOverlay && e.key === 'Escape') {
      e.preventDefault();
      setAtMenuDismissed(true);
      return;
    }

    if (isModelCommand && filteredModels.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % filteredModels.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + filteredModels.length) % filteredModels.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        selectModel(filteredModels[highlightIndex]);
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        selectModel(filteredModels[highlightIndex]);
        return;
      }
    }

    if (e.key === 'Escape') {
      if (isModelCommand) {
        e.preventDefault();
        setModelCommandDismissed(true);
        return;
      }
      if (isAgentActive && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Scroll highlighted item into view (model overlay)
  useEffect(() => {
    if (!isModelCommand || !overlayRef.current) return;
    const highlighted = overlayRef.current.querySelector('[data-highlighted="true"]');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isModelCommand]);

  // Scroll highlighted item into view (file overlay)
  useEffect(() => {
    if (!showFileOverlay || !fileOverlayRef.current) return;
    const highlighted = fileOverlayRef.current.querySelector('[data-highlighted="true"]');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [fileHighlightIndex, showFileOverlay]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const hasModels = availableModels.length > 0;
  const showModelOverlay = isModelCommand && hasModels;

  return (
    <form
      onSubmit={handleSubmit}
      className={`border-t border-border bg-surface-0 dark:bg-surface-0 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`}
    >
      <div className="relative flex gap-2">
        {showModelOverlay && (
          <div
            ref={overlayRef}
            className="absolute bottom-full left-0 right-10 mb-1.5 max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-surface-0 shadow-panel dark:border-neutral-700 dark:bg-surface-1"
          >
            {filteredModels.length === 0 ? (
              <div className="px-3 py-2.5 font-mono text-[10px] text-neutral-400">
                No matching models
              </div>
            ) : (
              groupedFiltered.map(([provider, models]) => (
                <div key={provider}>
                  <div className="sticky top-0 bg-surface-1/80 px-3 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.08em] text-neutral-400 backdrop-blur-sm dark:bg-surface-2/80 dark:text-neutral-500">
                    {provider}
                  </div>
                  {models.map((m) => {
                    const idx = filteredModels.indexOf(m);
                    const isHighlighted = idx === highlightIndex;
                    const isSelected = m.id === selectedModel;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        data-highlighted={isHighlighted}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition-colors ${
                          isHighlighted
                            ? 'bg-accent/8 text-accent dark:bg-accent/15'
                            : 'text-neutral-600 hover:bg-surface-1 dark:text-neutral-400 dark:hover:bg-surface-2'
                        }`}
                        onMouseEnter={() => setHighlightIndex(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault(); // prevent blur
                          selectModel(m);
                        }}
                      >
                        <span className="flex-1">{m.name}</span>
                        {isSelected && (
                          <span className="text-[9px] font-medium text-accent/70">current</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
        {showFileOverlay && (
          <div
            ref={fileOverlayRef}
            className="absolute bottom-full left-0 right-10 mb-1.5 max-h-60 overflow-y-auto rounded-lg border border-neutral-200 bg-surface-0 shadow-panel dark:border-neutral-700 dark:bg-surface-1"
          >
            {fileFinderLoading ? (
              <div className="px-3 py-2.5 font-mono text-[10px] text-neutral-400">
                Searching...
              </div>
            ) : filePaths.length === 0 ? (
              <div className="px-3 py-2.5 font-mono text-[10px] text-neutral-400">
                {atQuery ? 'No files found' : 'Type to search files...'}
              </div>
            ) : (
              filePaths.map((filePath, idx) => {
                const isHighlighted = idx === fileHighlightIndex;
                return (
                  <button
                    key={filePath}
                    type="button"
                    data-highlighted={isHighlighted}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] transition-colors ${
                      isHighlighted
                        ? 'bg-accent/8 text-accent dark:bg-accent/15'
                        : 'text-neutral-600 hover:bg-surface-1 dark:text-neutral-400 dark:hover:bg-surface-2'
                    }`}
                    onMouseEnter={() => setFileHighlightIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectFile(filePath);
                    }}
                  >
                    <FileIcon className="h-3 w-3 shrink-0 text-neutral-400" />
                    <span className="flex-1 truncate">{truncatePath(filePath)}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            updateCursorPos();
          }}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onSelect={updateCursorPos}
          onClick={updateCursorPos}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-lg border border-neutral-200 bg-surface-1/40 px-3.5 py-2.5 text-[13px] text-neutral-900 placeholder:text-neutral-400 transition-colors focus-visible:border-accent/30 focus-visible:bg-surface-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-surface-1 dark:text-neutral-100 dark:placeholder:text-neutral-500 dark:focus-visible:border-accent/30 dark:focus-visible:bg-surface-0"
        />
        {isAgentActive ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onAbort}
          >
            Stop
          </Button>
        ) : (
          <Button type="submit" disabled={!value.trim() || disabled || sendDisabled || isSendingFiles} size="sm">
            {isSendingFiles ? 'Loading...' : 'Send'}
          </Button>
        )}
      </div>
      <div className={`flex items-center justify-between gap-3 ${compact ? 'mt-1' : 'mt-1.5'}`}>
        {!compact && (
          <p className="font-mono text-[9px] tracking-wide text-neutral-400/70 dark:text-neutral-500">
            {sessionStatus === 'restoring'
              ? 'restoring session...'
              : sessionStatus === 'hibernated'
                ? 'hibernated — focus to restore'
                : sessionStatus === 'hibernating'
                  ? 'hibernating...'
                  : isAgentActive
                    ? 'esc to stop · shift+enter for new line · @ files · /model'
                    : 'enter to send · shift+enter for new line · @ files · /model'}
          </p>
        )}
        {compact && <div className="flex-1" />}
        {hasModels && (
          <select
            value={selectedModel}
            onChange={(e) => onModelChange?.(e.target.value)}
            className="shrink-0 cursor-pointer appearance-none rounded-md border border-neutral-200/80 bg-surface-1/60 px-2 py-0.5 font-mono text-[9px] font-medium text-neutral-500 transition-colors hover:border-neutral-300 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30 dark:border-neutral-700 dark:bg-surface-2 dark:text-neutral-400 dark:hover:border-neutral-600"
          >
            <option value="">Default model</option>
            {availableModels.map((provider) => (
              <optgroup key={provider.provider} label={provider.provider}>
                {provider.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
    </form>
  );
}

function FileIcon({ className }: { className?: string }) {
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
