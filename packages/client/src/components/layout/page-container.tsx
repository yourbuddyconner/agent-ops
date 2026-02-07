import { cn } from '@/lib/cn';

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div className={cn('p-3 md:p-6', className)}>{children}</div>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 text-balance dark:text-neutral-100 sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-neutral-500 text-pretty">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 sm:self-auto">{actions}</div>}
    </div>
  );
}
