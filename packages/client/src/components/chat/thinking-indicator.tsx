type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

interface ThinkingIndicatorProps {
  status?: AgentStatus;
  detail?: string;
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Ready',
  thinking: 'Thinking...',
  tool_calling: 'Running tool...',
  streaming: 'Writing...',
  error: 'Error',
};

export function ThinkingIndicator({ status = 'thinking', detail }: ThinkingIndicatorProps) {
  const label = detail || STATUS_LABELS[status] || 'Working...';

  return (
    <div className="flex gap-3 bg-surface-1 px-4 py-3 dark:bg-surface-1">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent/10 font-mono text-[10px] font-semibold text-accent">
        A
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">
            Assistant
          </span>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex gap-1">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60 [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent/60" />
          </div>
          <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
            {label}
          </span>
        </div>
      </div>
    </div>
  );
}
