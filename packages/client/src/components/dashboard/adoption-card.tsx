import { useAdoptionMetrics } from '@/api/dashboard';

function PRIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <circle cx="4" cy="4" r="2" />
      <path d="M8.67 4H10a1.33 1.33 0 0 1 1.33 1.33V7.33" />
      <line x1="4" y1="6" x2="4" y2="14" />
    </svg>
  );
}

function MergeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="4" cy="4" r="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M4 6v8M4 6c2 0 6 2 8 6" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2.5" />
      <line x1="8" y1="2" x2="8" y2="5.5" />
      <line x1="8" y1="10.5" x2="8" y2="14" />
    </svg>
  );
}

interface AdoptionCardProps {
  periodDays?: number;
}

export function AdoptionCard({ periodDays = 30 }: AdoptionCardProps) {
  const { data, isLoading } = useAdoptionMetrics(periodDays);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-neutral-200/80 bg-white p-5 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] animate-stagger-in">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-1 text-neutral-400">
            <PRIcon />
          </span>
          <span className="label-mono text-neutral-400">Agent Adoption</span>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-5 w-full animate-pulse rounded bg-neutral-100" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="rounded-lg border border-neutral-200/80 bg-white p-5 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition-shadow hover:shadow-[0_2px_8px_-2px_rgb(0_0_0/0.08)] animate-stagger-in">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-1 text-neutral-400">
          <PRIcon />
        </span>
        <span className="label-mono text-neutral-400">Agent Adoption</span>
      </div>

      <div className="space-y-3">
        <AdoptionRow
          icon={<PRIcon />}
          label="PRs Created"
          value={data.totalPRsCreated}
        />
        <AdoptionRow
          icon={<MergeIcon />}
          label="PRs Merged"
          value={data.totalPRsMerged}
          suffix={data.mergeRate > 0 ? `${data.mergeRate}%` : undefined}
        />
        <AdoptionRow
          icon={<CommitIcon />}
          label="Commits"
          value={data.totalCommits}
        />
      </div>
    </div>
  );
}

function AdoptionRow({
  icon,
  label,
  value,
  suffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-neutral-400">{icon}</span>
        <span className="font-mono text-[12px] text-neutral-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[14px] font-semibold tabular-nums text-neutral-900">
          {value.toLocaleString()}
        </span>
        {suffix && (
          <span className="font-mono text-[10px] text-neutral-400">{suffix}</span>
        )}
      </div>
    </div>
  );
}
