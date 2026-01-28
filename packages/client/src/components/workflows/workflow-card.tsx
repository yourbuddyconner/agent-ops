import { Link } from '@tanstack/react-router';
import type { Workflow } from '@/api/workflows';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatRelativeTime } from '@/lib/format';

interface WorkflowCardProps {
  workflow: Workflow;
}

export function WorkflowCard({ workflow }: WorkflowCardProps) {
  const stepCount = workflow.data?.steps?.length ?? 0;

  return (
    <Link to="/workflows/$workflowId" params={{ workflowId: workflow.id }}>
      <Card className="h-full hover:border-neutral-300 dark:hover:border-neutral-600">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">{workflow.name}</CardTitle>
              {workflow.slug && (
                <code className="mt-0.5 block truncate text-xs text-neutral-400">
                  {workflow.slug}
                </code>
              )}
            </div>
            <Badge variant={workflow.enabled ? 'success' : 'secondary'}>
              {workflow.enabled ? 'Active' : 'Disabled'}
            </Badge>
          </div>
          {workflow.description && (
            <CardDescription className="line-clamp-2 mt-1">
              {workflow.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between text-sm text-neutral-500 dark:text-neutral-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <StepsIcon className="size-3.5" />
                {stepCount} {stepCount === 1 ? 'step' : 'steps'}
              </span>
              <span className="text-neutral-300 dark:text-neutral-600">|</span>
              <span>v{workflow.version}</span>
            </div>
            <span className="tabular-nums">
              {formatRelativeTime(workflow.updatedAt)}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function StepsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
      <path d="M12 20v2" />
      <path d="M12 14v2" />
      <path d="M12 8v2" />
      <path d="M12 2v2" />
    </svg>
  );
}
