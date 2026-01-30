import { cn } from '@/lib/cn';

interface HeroMetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta?: number;
  tooltip?: string;
  index?: number;
}

export function HeroMetricCard({ icon, label, value, delta, tooltip, index = 0 }: HeroMetricCardProps) {
  return (
    <div
      className="group relative rounded-lg border border-neutral-200/80 bg-white p-5 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)] transition-shadow hover:shadow-[0_2px_8px_-2px_rgb(0_0_0/0.08)] animate-stagger-in"
      style={{ animationDelay: `${index * 60}ms` }}
      title={tooltip}
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-1 text-neutral-400 transition-colors group-hover:bg-accent/8 group-hover:text-accent">
          {icon}
        </span>
        <span className="label-mono text-neutral-400">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2.5">
        <span className="text-[28px] font-semibold leading-none tabular-nums tracking-tight text-neutral-900 animate-number-in" style={{ animationDelay: `${index * 60 + 120}ms` }}>
          {value}
        </span>
        {delta !== undefined && delta !== 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums leading-none',
              delta > 0
                ? 'bg-emerald-500/8 text-emerald-600'
                : 'bg-red-500/8 text-red-600'
            )}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className={cn(delta < 0 && 'rotate-180')}>
              <path d="M5 2.5L7.5 5.5H2.5L5 2.5Z" fill="currentColor" />
            </svg>
            {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  );
}
