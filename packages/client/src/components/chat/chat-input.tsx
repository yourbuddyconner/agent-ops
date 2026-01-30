import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import type { ProviderModels } from '@/hooks/use-chat';

interface ChatInputProps {
  onSend: (content: string, model?: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  availableModels?: ProviderModels[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
}

interface FlatModel {
  id: string;
  name: string;
  provider: string;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
  inputRef,
  availableModels = [],
  selectedModel = '',
  onModelChange,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [modelCommandDismissed, setModelCommandDismissed] = useState(false);
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalRef;
  const overlayRef = useRef<HTMLDivElement>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;

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

    onSend(value.trim(), selectedModel || undefined);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
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

    if (e.key === 'Escape' && isModelCommand) {
      e.preventDefault();
      setModelCommandDismissed(true);
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Scroll highlighted item into view
  useEffect(() => {
    if (!isModelCommand || !overlayRef.current) return;
    const highlighted = overlayRef.current.querySelector('[data-highlighted="true"]');
    highlighted?.scrollIntoView({ block: 'nearest' });
  }, [highlightIndex, isModelCommand]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  const hasModels = availableModels.length > 0;
  const showOverlay = isModelCommand && hasModels;

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-neutral-200 bg-surface-0 p-3 dark:border-neutral-800 dark:bg-surface-0"
    >
      <div className="relative flex gap-2">
        {showOverlay && (
          <div
            ref={overlayRef}
            className="absolute bottom-full left-0 right-10 mb-1 max-h-60 overflow-y-auto rounded-md border border-neutral-200 bg-surface-0 shadow-lg dark:border-neutral-700 dark:bg-surface-1"
          >
            {filteredModels.length === 0 ? (
              <div className="px-3 py-2 font-mono text-[11px] text-neutral-400">
                No matching models
              </div>
            ) : (
              groupedFiltered.map(([provider, models]) => (
                <div key={provider}>
                  <div className="sticky top-0 bg-neutral-50 px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
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
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[12px] transition-colors ${
                          isHighlighted
                            ? 'bg-accent/10 text-accent dark:bg-accent/20'
                            : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                        }`}
                        onMouseEnter={() => setHighlightIndex(idx)}
                        onMouseDown={(e) => {
                          e.preventDefault(); // prevent blur
                          selectModel(m);
                        }}
                      >
                        <span className="flex-1">{m.name}</span>
                        {isSelected && (
                          <span className="text-[10px] text-accent">current</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 resize-none rounded-md border border-neutral-200 bg-surface-0 px-3 py-2 text-[13px] text-neutral-900 placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-1 focus-visible:ring-offset-surface-0 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-surface-1 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <Button type="submit" disabled={!value.trim() || disabled} size="sm">
          Send
        </Button>
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <p className="font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
          Enter to send · Shift+Enter for new line · /model to switch
        </p>
        {hasModels && (
          <select
            value={selectedModel}
            onChange={(e) => onModelChange?.(e.target.value)}
            className="rounded border border-neutral-200 bg-surface-0 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 dark:border-neutral-700 dark:bg-surface-1 dark:text-neutral-400"
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
