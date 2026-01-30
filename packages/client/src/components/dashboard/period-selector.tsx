import { cn } from '@/lib/cn';

const PERIODS = [
  { label: '1h', value: 1 },
  { label: '1d', value: 24 },
  { label: '1wk', value: 168 },
  { label: '1mo', value: 720 },
] as const;

interface PeriodSelectorProps {
  value: number;
  onChange: (period: number) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="inline-flex items-center rounded-lg border border-neutral-200/80 bg-surface-1 p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => onChange(p.value)}
          className={cn(
            'rounded-md px-3 py-1 font-mono text-2xs font-medium tracking-wide transition-all',
            value === p.value
              ? 'bg-white text-neutral-900 shadow-[0_1px_2px_0_rgb(0_0_0/0.06)]'
              : 'text-neutral-400 hover:text-neutral-600'
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
