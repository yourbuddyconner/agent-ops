type AgentStatus = 'idle' | 'thinking' | 'tool_calling' | 'streaming' | 'error';

interface ThinkingIndicatorProps {
  status?: AgentStatus;
  detail?: string;
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Ready',
  thinking: 'Thinking',
  tool_calling: 'Running tool',
  streaming: 'Writing',
  error: 'Error',
};

export function ThinkingIndicator({ status = 'thinking', detail }: ThinkingIndicatorProps) {
  const label = detail || STATUS_LABELS[status] || 'Working';

  return (
    <div className="flex gap-3 py-3 animate-fade-in">
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-accent/8 text-accent mt-0.5">
        <BotIcon className="h-3 w-3" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="font-mono text-[11px] font-semibold tracking-tight text-neutral-800 dark:text-neutral-200">
            Agent
          </span>
        </div>

        <div className="border-l-[1.5px] border-accent/15 pl-3 dark:border-accent/10">
          <div className="flex items-center gap-2">
            <div className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent/50 [animation-delay:-0.3s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent/50 [animation-delay:-0.15s]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-accent/50" />
            </div>
            <span className="font-mono text-[10px] text-neutral-400 dark:text-neutral-500">
              {label}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}
