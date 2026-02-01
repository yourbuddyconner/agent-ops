import { useState, useEffect } from 'react';
import { useSession, useSessionGitState } from '@/api/sessions';
import { Badge } from '@/components/ui/badge';
import type { PRState } from '@/api/types';

interface SessionMetadataSidebarProps {
  sessionId: string;
}

export function SessionMetadataSidebar({ sessionId }: SessionMetadataSidebarProps) {
  const { data: session } = useSession(sessionId);
  const { data: gitState } = useSessionGitState(sessionId);

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!session?.createdAt) return;
    const start = new Date(session.createdAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - start) / 1000));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session?.createdAt]);

  const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  return (
    <div className="flex h-full w-[260px] flex-col border-l border-neutral-200 bg-surface-0 dark:border-neutral-800 dark:bg-surface-0">
      <div className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <span className="font-mono text-[11px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          Session Info
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {/* Duration */}
        <SidebarSection label="Duration">
          <span className="font-mono text-[12px] text-neutral-700 dark:text-neutral-300 tabular-nums">
            {formatDuration(elapsed)}
          </span>
        </SidebarSection>

        {/* Repository */}
        {(gitState?.sourceRepoFullName || session?.workspace) && (
          <SidebarSection label="Repository">
            {gitState?.sourceRepoUrl ? (
              <a
                href={gitState.sourceRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-[12px] text-accent hover:underline"
              >
                <GitHubIcon className="h-3 w-3 shrink-0" />
                {gitState.sourceRepoFullName || session?.workspace}
              </a>
            ) : (
              <span className="font-mono text-[12px] text-neutral-700 dark:text-neutral-300">
                {gitState?.sourceRepoFullName || session?.workspace}
              </span>
            )}
          </SidebarSection>
        )}

        {/* Branch */}
        {gitState?.branch && (
          <SidebarSection label="Branch">
            <div className="flex items-center gap-1.5">
              <BranchIcon className="h-3 w-3 shrink-0 text-neutral-400" />
              <CopyableText text={gitState.branch} />
            </div>
            {gitState.baseBranch && (
              <span className="mt-0.5 block font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
                from {gitState.baseBranch}
              </span>
            )}
          </SidebarSection>
        )}

        {/* PR Status */}
        {gitState?.prNumber && (
          <SidebarSection label="Pull Request">
            <div className="flex items-center gap-1.5">
              <PRStateBadge state={gitState.prState} />
              {gitState.prUrl ? (
                <a
                  href={gitState.prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[12px] text-accent hover:underline truncate"
                >
                  #{gitState.prNumber} {gitState.prTitle}
                </a>
              ) : (
                <span className="font-mono text-[12px] text-neutral-700 dark:text-neutral-300 truncate">
                  #{gitState.prNumber} {gitState.prTitle}
                </span>
              )}
            </div>
          </SidebarSection>
        )}

        {/* Source context */}
        {gitState?.sourceType === 'issue' && gitState.sourceIssueNumber && (
          <SidebarSection label="Source">
            <span className="font-mono text-[12px] text-neutral-600 dark:text-neutral-400">
              From Issue #{gitState.sourceIssueNumber}
            </span>
          </SidebarSection>
        )}
        {gitState?.sourceType === 'pr' && gitState.sourcePrNumber && (
          <SidebarSection label="Source">
            <span className="font-mono text-[12px] text-neutral-600 dark:text-neutral-400">
              From PR #{gitState.sourcePrNumber}
            </span>
          </SidebarSection>
        )}

        {/* Stats */}
        <SidebarSection label="Stats">
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {gitState?.commitCount != null && gitState.commitCount > 0 && (
              <StatItem label="Commits" value={gitState.commitCount} />
            )}
          </div>
        </SidebarSection>
      </div>
    </div>
  );
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block font-mono text-[10px] font-medium uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
        {label}
      </span>
      {children}
    </div>
  );
}

function StatItem({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{label}</span>
      <span className="font-mono text-[12px] font-medium text-neutral-700 dark:text-neutral-300 tabular-nums">
        {value}
      </span>
    </div>
  );
}

function CopyableText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 font-mono text-[12px] text-neutral-700 hover:text-accent dark:text-neutral-300 dark:hover:text-accent transition-colors truncate"
      title="Click to copy"
    >
      <span className="truncate">{text}</span>
      {copied ? (
        <CheckIcon className="h-3 w-3 shrink-0 text-green-500" />
      ) : (
        <CopyIcon className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100" />
      )}
    </button>
  );
}

function PRStateBadge({ state }: { state: PRState | null }) {
  if (!state) return null;
  const variants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
    draft: 'secondary',
    open: 'success',
    closed: 'error',
    merged: 'default',
  };
  return <Badge variant={variants[state] ?? 'default'}>{state}</Badge>;
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function BranchIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
