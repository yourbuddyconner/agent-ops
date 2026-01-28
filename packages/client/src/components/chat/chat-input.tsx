import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
}

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Type a message...',
  inputRef,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = inputRef ?? internalRef;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;

    onSend(value.trim());
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-neutral-200 bg-surface-0 p-3 dark:border-neutral-800 dark:bg-surface-0"
    >
      <div className="flex gap-2">
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
      <p className="mt-1.5 font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
        Enter to send · Shift+Enter for new line
      </p>
    </form>
  );
}
