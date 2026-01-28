import { cn } from '@/lib/cn';

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-2 dark:bg-surface-2', className)}
      {...props}
    />
  );
}

export { Skeleton };
