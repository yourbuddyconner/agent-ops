import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { DashboardDayActivity } from '@/api/types';

interface ActivityChartProps {
  data: DashboardDayActivity[];
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-neutral-200/80 bg-white px-3 py-2.5 shadow-[0_4px_12px_-4px_rgb(0_0_0/0.1)]">
      <p className="mb-1.5 font-mono text-2xs text-neutral-400">{formatDateLabel(String(label))}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-xs text-neutral-500">{entry.name}</span>
          <span className="ml-auto font-mono text-xs font-medium tabular-nums text-neutral-900">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

function CustomLegend({ payload }: { payload?: Array<{ value: string; color: string }> }) {
  if (!payload?.length) return null;
  return (
    <div className="flex items-center justify-end gap-4 pt-2">
      {payload.map((entry) => (
        <div key={entry.value} className="flex items-center gap-1.5">
          <span className="h-[3px] w-3 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="font-mono text-2xs text-neutral-400">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ActivityChart({ data }: ActivityChartProps) {
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-neutral-200/80 bg-white p-6 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]">
        <h3 className="label-mono text-neutral-400 mb-4">Activity</h3>
        <div className="flex h-[240px] items-center justify-center text-[13px] text-neutral-300">
          No activity data for this period
        </div>
      </div>
    );
  }

  return (
    <div className="animate-stagger-in rounded-lg border border-neutral-200/80 bg-white p-6 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]" style={{ animationDelay: '200ms' }}>
      <h3 className="label-mono text-neutral-400 mb-4">Activity</h3>
      <ResponsiveContainer width="100%" height={260}>
        <AreaChart data={data} margin={{ top: 4, right: -16, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="gradSessions" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(99 102 241)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="rgb(99 102 241)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradMessages" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgb(245 245 245)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateLabel}
            tick={{ fontSize: 10, fill: '#a3a3a3', fontFamily: '"JetBrains Mono", monospace' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="sessions"
            tick={{ fontSize: 10, fill: '#a3a3a3', fontFamily: '"JetBrains Mono", monospace' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            domain={[0, 'auto']}
            minTickGap={20}
            tickFormatter={(value: number) => Number.isInteger(value) ? String(value) : ''}
            width={35}
          />
          <YAxis
            yAxisId="messages"
            orientation="right"
            tick={{ fontSize: 10, fill: '#a3a3a3', fontFamily: '"JetBrains Mono", monospace' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
            domain={[0, 'auto']}
            minTickGap={20}
            tickFormatter={(value: number) => Number.isInteger(value) ? String(value) : ''}
            width={35}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend content={<CustomLegend />} />
          <Area
            yAxisId="sessions"
            type="monotone"
            dataKey="sessions"
            name="Sessions"
            stroke="rgb(99 102 241)"
            strokeWidth={1.5}
            fill="url(#gradSessions)"
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, fill: 'white', stroke: 'rgb(99 102 241)' }}
          />
          <Area
            yAxisId="messages"
            type="monotone"
            dataKey="messages"
            name="Messages"
            stroke="rgb(16 185 129)"
            strokeWidth={1.5}
            fill="url(#gradMessages)"
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, fill: 'white', stroke: 'rgb(16 185 129)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
