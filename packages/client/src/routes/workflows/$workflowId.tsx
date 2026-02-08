import { createFileRoute, Link } from '@tanstack/react-router';
import React from 'react';
import { PageContainer, PageHeader } from '@/components/layout/page-container';
import {
  useWorkflow,
  useRunWorkflow,
  useWorkflowProposals,
  useApplyWorkflowProposal,
  useReviewWorkflowProposal,
  useWorkflowHistory,
  useRollbackWorkflowVersion,
} from '@/api/workflows';
import { useWorkflowExecutions, useExecutionSteps, useApproveExecution, type Execution } from '@/api/executions';
import { useTriggers, useCreateTrigger } from '@/api/triggers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EditWorkflowDialog } from '@/components/workflows/edit-workflow-dialog';
import { EditWorkflowStepDialog } from '@/components/workflows/edit-workflow-step-dialog';
import { formatRelativeTime } from '@/lib/format';

export const Route = createFileRoute('/workflows/$workflowId')({
  component: WorkflowDetailPage,
});

function WorkflowDetailPage() {
  const { workflowId } = Route.useParams();
  const { data, isLoading, error } = useWorkflow(workflowId);
  const { data: executionsData, isLoading: executionsLoading } = useWorkflowExecutions(workflowId);
  const { data: proposalsData, isLoading: proposalsLoading } = useWorkflowProposals(workflowId);
  const { data: historyData, isLoading: historyLoading } = useWorkflowHistory(workflowId);
  const { data: triggersData } = useTriggers();
  const runWorkflow = useRunWorkflow();
  const createTrigger = useCreateTrigger();
  const applyProposal = useApplyWorkflowProposal();
  const reviewProposal = useReviewWorkflowProposal();
  const rollbackWorkflow = useRollbackWorkflowVersion();

  const workflow = data?.workflow;
  const executions = executionsData?.executions ?? [];
  const proposals = proposalsData?.proposals ?? [];
  const history = historyData?.history ?? [];
  const triggers = (triggersData?.triggers ?? []).filter(t => t.workflowId === workflowId);

  const handleRun = async () => {
    try {
      await runWorkflow.mutateAsync({ workflowId });
    } catch (err) {
      console.error('Failed to run workflow:', err);
    }
  };

  const handleCreateManualTrigger = async () => {
    try {
      await createTrigger.mutateAsync({
        workflowId,
        name: 'Manual Trigger',
        enabled: true,
        config: { type: 'manual' },
      });
    } catch (err) {
      console.error('Failed to create trigger:', err);
    }
  };

  if (isLoading) {
    return (
      <PageContainer>
        <WorkflowDetailSkeleton />
      </PageContainer>
    );
  }

  if (error || !workflow) {
    return (
      <PageContainer>
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-pretty text-red-600 dark:text-red-400">
            Failed to load workflow. It may not exist or you don't have access.
          </p>
          <Link
            to="/workflows"
            className="mt-2 inline-block text-sm text-red-600 underline dark:text-red-400"
          >
            Back to workflows
          </Link>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={workflow.name}
        description={workflow.description || undefined}
        actions={
          <div className="flex items-center gap-2">
            <EditWorkflowDialog workflow={workflow} />
            <Button
              onClick={handleRun}
              disabled={runWorkflow.isPending}
              size="sm"
            >
              {runWorkflow.isPending ? 'Running...' : 'Run Now'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main content */}
        <div className="space-y-6 lg:col-span-2">
          {/* Steps */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Workflow Steps</CardTitle>
              <CardDescription>
                {workflow.data.steps?.length || 0} steps in this workflow
              </CardDescription>
            </CardHeader>
            <CardContent>
              {workflow.data.steps && workflow.data.steps.length > 0 ? (
                <div className="space-y-3">
                  {workflow.data.steps.map((step, index) => (
                    <div
                      key={step.id}
                      className="group flex items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700"
                    >
                      <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-neutral-900 dark:text-neutral-100">
                            {step.name}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            {step.type}
                          </Badge>
                        </div>
                        {step.tool && (
                          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                            Tool: <code className="rounded bg-neutral-100 px-1 dark:bg-neutral-700">{step.tool}</code>
                          </p>
                        )}
                        {step.goal && (
                          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300 line-clamp-2">
                            {step.goal}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 opacity-0 group-hover:opacity-100">
                        <EditWorkflowStepDialog
                          workflow={workflow}
                          step={step}
                          stepIndex={index}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pretty text-neutral-500 dark:text-neutral-400">
                  No steps defined in this workflow.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Recent Executions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Executions</CardTitle>
            </CardHeader>
            <CardContent>
              {executionsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : executions.length > 0 ? (
                <div className="space-y-2">
                  {executions.slice(0, 10).map((execution) => (
                    <ExecutionRow key={execution.id} execution={execution} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pretty text-neutral-500 dark:text-neutral-400">
                  No executions yet. Run the workflow to see execution history.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Metadata */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">Status</span>
                <Badge variant={workflow.enabled ? 'success' : 'secondary'}>
                  {workflow.enabled ? 'Active' : 'Disabled'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">Version</span>
                <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {workflow.version}
                </span>
              </div>
              {workflow.slug && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">Slug</span>
                  <code className="text-sm text-neutral-900 dark:text-neutral-100">
                    {workflow.slug}
                  </code>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">Updated</span>
                <span className="text-sm text-neutral-900 dark:text-neutral-100">
                  {formatRelativeTime(workflow.updatedAt)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Triggers */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Triggers</CardTitle>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleCreateManualTrigger}
                  disabled={createTrigger.isPending}
                >
                  Add
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {triggers.length > 0 ? (
                <div className="space-y-2">
                  {triggers.map((trigger) => (
                    <div
                      key={trigger.id}
                      className="flex items-center justify-between rounded-lg border border-neutral-200 p-2 dark:border-neutral-700"
                    >
                      <div className="flex items-center gap-2">
                        <TriggerTypeIcon type={trigger.type} />
                        <div>
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {trigger.name}
                          </p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {trigger.type}
                          </p>
                        </div>
                      </div>
                      <Badge variant={trigger.enabled ? 'success' : 'secondary'} className="text-xs">
                        {trigger.enabled ? 'On' : 'Off'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pretty text-neutral-500 dark:text-neutral-400">
                  No triggers configured. Add a trigger to automate this workflow.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Mutation Proposals</CardTitle>
              <CardDescription>
                Review and apply workflow self-modification proposals.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {proposalsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : proposals.length > 0 ? (
                <div className="space-y-2">
                  {proposals.slice(0, 8).map((proposal) => (
                    <div
                      key={proposal.id}
                      className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-700"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                            {proposal.id.slice(0, 8)}...
                          </p>
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {formatRelativeTime(proposal.createdAt)}
                          </p>
                        </div>
                        <Badge variant={proposal.status === 'approved' ? 'warning' : proposal.status === 'applied' ? 'success' : proposal.status === 'rejected' ? 'error' : 'secondary'}>
                          {proposal.status}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center justify-end gap-2">
                        {proposal.status === 'pending' && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={reviewProposal.isPending}
                              onClick={() => reviewProposal.mutate({ workflowId, proposalId: proposal.id, data: { approve: false } })}
                            >
                              Reject
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={reviewProposal.isPending}
                              onClick={() => reviewProposal.mutate({ workflowId, proposalId: proposal.id, data: { approve: true } })}
                            >
                              Approve
                            </Button>
                          </>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={proposal.status !== 'approved' || applyProposal.isPending}
                          onClick={() => applyProposal.mutate({ workflowId, proposalId: proposal.id })}
                        >
                          Apply
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-pretty text-neutral-500 dark:text-neutral-400">
                  No proposals yet.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Version History</CardTitle>
              <CardDescription>
                Immutable workflow snapshots for one-click rollback.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {historyLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : history.length > 0 ? (
                <div className="space-y-2">
                  {history.slice(0, 8).map((entry) => {
                    const isCurrent = historyData?.currentWorkflowHash === entry.workflowHash;
                    return (
                      <div
                        key={entry.id}
                        className="rounded-lg border border-neutral-200 p-2 dark:border-neutral-700"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
                              {entry.workflowHash}
                            </p>
                            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              {entry.source} {formatRelativeTime(entry.createdAt)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={isCurrent || rollbackWorkflow.isPending}
                            onClick={() => rollbackWorkflow.mutate({ workflowId, data: { targetWorkflowHash: entry.workflowHash } })}
                          >
                            Rollback
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-pretty text-neutral-500 dark:text-neutral-400">
                  No version snapshots yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}

function ExecutionRow({ execution }: { execution: Execution }) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: stepData, isLoading } = useExecutionSteps(expanded ? execution.id : '');
  const approveExecution = useApproveExecution();
  const steps = stepData?.steps ?? [];

  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ExecutionStatusBadge status={execution.status} />
          <div>
            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {execution.triggerType} trigger
            </p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {execution.id.slice(0, 8)}...
            </p>
            {execution.error && (
              <p className="mt-1 text-xs text-pretty text-red-600 dark:text-red-400">
                {execution.error}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-neutral-500 tabular-nums dark:text-neutral-400">
            {formatRelativeTime(execution.startedAt)}
          </span>
          {execution.status === 'waiting_approval' && execution.resumeToken && (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={approveExecution.isPending}
                onClick={() => approveExecution.mutate({
                  executionId: execution.id,
                  data: {
                    approve: false,
                    resumeToken: execution.resumeToken!,
                    reason: 'approval_denied',
                  },
                })}
              >
                Deny
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={approveExecution.isPending}
                onClick={() => approveExecution.mutate({
                  executionId: execution.id,
                  data: {
                    approve: true,
                    resumeToken: execution.resumeToken!,
                  },
                })}
              >
                Approve
              </Button>
            </>
          )}
          <Button size="sm" variant="secondary" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide Steps' : 'View Steps'}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-1 border-t border-neutral-200 pt-3 dark:border-neutral-700">
          {execution.outputs && (
            <details className="mb-2 rounded border border-neutral-200 px-2 py-1 dark:border-neutral-700">
              <summary className="cursor-pointer text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Execution Output
              </summary>
              <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                {formatExecutionValue(execution.outputs)}
              </pre>
            </details>
          )}

          {isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : steps.length > 0 ? (
            steps.slice(0, 12).map((step) => (
              <div key={step.id} className="rounded border border-neutral-200 px-2 py-2 dark:border-neutral-700">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                      {step.stepId}
                    </span>
                    <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      attempt {step.attempt}
                    </p>
                  </div>
                  <Badge variant={step.status === 'completed' ? 'success' : step.status === 'failed' ? 'error' : 'secondary'}>
                    {step.status}
                  </Badge>
                </div>

                {step.error && (
                  <p className="mt-2 text-xs text-pretty text-red-600 dark:text-red-400">
                    {step.error}
                  </p>
                )}

                {step.output !== null && step.output !== undefined && (
                  <details className="mt-2 rounded border border-neutral-200 px-2 py-1 dark:border-neutral-700">
                    <summary className="cursor-pointer text-xs font-medium text-neutral-700 dark:text-neutral-300">
                      Step Output
                    </summary>
                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                      {formatExecutionValue(step.output)}
                    </pre>
                  </details>
                )}
              </div>
            ))
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              No normalized steps captured yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ExecutionStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
    pending: 'warning',
    running: 'default',
    waiting_approval: 'warning',
    completed: 'success',
    cancelled: 'secondary',
    failed: 'error',
  };

  return <Badge variant={variants[status] ?? 'secondary'}>{status}</Badge>;
}

function formatExecutionValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function TriggerTypeIcon({ type }: { type: string }) {
  const iconClass = "size-4 text-neutral-400";

  if (type === 'webhook') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
        <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
        <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
        <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
      </svg>
    );
  }

  if (type === 'schedule') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={iconClass}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function WorkflowDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
