import * as React from 'react';
import { cn } from '@/lib/cn';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'secondary';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider',
        {
          'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400': variant === 'default',
          'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400': variant === 'success',
          'bg-amber-500/10 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400': variant === 'warning',
          'bg-red-500/10 text-red-600 dark:bg-red-500/10 dark:text-red-400': variant === 'error',
          'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-500': variant === 'secondary',
        },
        className
      )}
      {...props}
    />
  );
}

/** Small pulsing dot to indicate live status */
function StatusDot({ variant = 'default' }: { variant?: BadgeProps['variant'] }) {
  return (
    <span
      className={cn(
        'inline-block h-1.5 w-1.5 rounded-full',
        {
          'bg-neutral-400': variant === 'default',
          'bg-emerald-500 animate-pulse-dot': variant === 'success',
          'bg-amber-500 animate-pulse-dot': variant === 'warning',
          'bg-red-500 animate-pulse-dot': variant === 'error',
          'bg-neutral-500': variant === 'secondary',
        },
      )}
    />
  );
}

export { Badge, StatusDot };
export type { BadgeProps };
