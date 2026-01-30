import { Skeleton } from '@/components/ui/skeleton';

export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Hero metrics skeleton */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-neutral-200/80 bg-white p-5 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-md" />
              <Skeleton className="h-2.5 w-14" />
            </div>
            <Skeleton className="mt-4 h-7 w-16" />
          </div>
        ))}
      </div>

      {/* Activity chart skeleton */}
      <div className="rounded-lg border border-neutral-200/80 bg-white p-6 shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]">
        <Skeleton className="h-2.5 w-14 mb-4" />
        <Skeleton className="h-[260px] w-full rounded-md" />
      </div>

      {/* Bottom row skeleton */}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-lg border border-neutral-200/80 bg-white shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]">
          <div className="border-b border-neutral-100 px-5 py-3.5">
            <Skeleton className="h-2.5 w-24" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <Skeleton className="h-4 w-14 rounded-full" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-2 rounded-lg border border-neutral-200/80 bg-white shadow-[0_1px_2px_0_rgb(0_0_0/0.04)]">
          <div className="border-b border-neutral-100 px-5 py-3.5">
            <Skeleton className="h-2.5 w-24" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-5 py-3 space-y-2">
              <div className="flex justify-between">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-16" />
              </div>
              <Skeleton className="h-1 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
