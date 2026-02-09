import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { copyTextToClipboard } from '@/lib/clipboard';

interface MessageCopyButtonProps {
  text: string;
  className?: string;
}

export function MessageCopyButton({ text, className }: MessageCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) {
        clearTimeout(resetTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    const normalized = text.trim();
    if (!normalized) return;

    const ok = await copyTextToClipboard(normalized);
    if (!ok) return;

    setCopied(true);
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
    }
    resetTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className={cn(
        'rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-medium text-neutral-300 opacity-0 transition-all hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 dark:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300',
        className
      )}
      title="Copy message"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  );
}
