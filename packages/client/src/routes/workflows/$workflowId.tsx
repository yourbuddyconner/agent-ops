import { createFileRoute, Link } from '@tanstack/react-router';
import React from 'react';
import { PageContainer } from '@/components/layout/page-container';
import {
  useWorkflow,
  useRunWorkflow,
  useWorkflowProposals,
  useApplyWorkflowProposal,
  useReviewWorkflowProposal,
  useWorkflowHistory,
  useRollbackWorkflowVersion,
  type WorkflowStep,
} from '@/api/workflows';
import { useWorkflowExecutions, useExecutionSteps, useApproveExecution, type Execution } from '@/api/executions';
import { useTriggers } from '@/api/triggers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EditWorkflowDialog } from '@/components/workflows/edit-workflow-dialog';
import { EditWorkflowStepDialog } from '@/components/workflows/edit-workflow-step-dialog';
import { WorkflowTriggerManager } from '@/components/workflows/workflow-trigger-manager';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

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
  const applyProposal = useApplyWorkflowProposal();
  const reviewProposal = useReviewWorkflowProposal();
  const rollbackWorkflow = useRollbackWorkflowVersion();

  const workflow = data?.workflow;
  const executions = executionsData?.executions ?? [];
  const proposals = proposalsData?.proposals ?? [];
  const history = historyData?.history ?? [];
  const triggers = (triggersData?.triggers ?? []).filter((t) => t.workflowId === workflowId);

  const handleRun = async () => {
    try {
      await runWorkflow.mutateAsync({ workflowId });
    } catch (err) {
      console.error('Failed to run workflow:', err);
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

  const steps = workflow.data.steps ?? [];
  const enabledTriggerCount = triggers.filter((trigger) => trigger.enabled).length;
  const completedExecutions = executions.filter((execution) => execution.status === 'completed').length;
  const successRate = executions.length > 0
    ? `${Math.round((completedExecutions / executions.length) * 100)}%`
    : 'N/A';
  const pendingProposals = proposals.filter((proposal) => proposal.status === 'pending').length;
  const stepTypeCount = steps.reduce<Record<WorkflowStep['type'], number>>(
    (acc, step) => {
      acc[step.type] += 1;
      return acc;
    },
    {
      agent: 0,
      tool: 0,
      conditional: 0,
      loop: 0,
      parallel: 0,
      subworkflow: 0,
      approval: 0,
    },
  );

  return (
    <PageContainer className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-neutral-200 bg-gradient-to-br from-neutral-950 via-zinc-900 to-neutral-800 p-5 text-white shadow-panel dark:border-neutral-700 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full bg-cyan-300/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-10 h-44 w-44 rounded-full bg-amber-300/20 blur-3xl" />

        <div className="relative space-y-6">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="label-mono text-white/70">Workflow Engine</p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white text-balance sm:text-4xl">
                {workflow.name}
              </h1>
              <p className="mt-2 text-sm text-white/75 sm:text-base">
                {workflow.description || 'Compose autonomous, multi-step execution logic with approvals, branching, and runtime feedback loops.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Badge
                  variant={workflow.enabled ? 'success' : 'secondary'}
                  className="border border-white/15 bg-white/10 text-[11px] text-white"
                >
                  {workflow.enabled ? 'Active' : 'Disabled'}
                </Badge>
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
                  v{workflow.version}
                </span>
                {workflow.slug && (
                  <code className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/80">
                    {workflow.slug}
                  </code>
                )}
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-white/70">
                  Updated {formatRelativeTime(workflow.updatedAt)}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 self-start">
              <EditWorkflowDialog
                workflow={workflow}
                trigger={(
                  <Button
                    size="sm"
                    variant="secondary"
                    className="border-white/20 bg-white/10 text-white hover:bg-white/20"
                  >
                    Edit Workflow
                  </Button>
                )}
              />
              <Button
                onClick={handleRun}
                disabled={runWorkflow.isPending}
                size="sm"
                className="bg-cyan-500 text-neutral-950 hover:bg-cyan-400"
              >
                {runWorkflow.isPending ? 'Running...' : 'Run Now'}
              </Button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <HeroStat
              label="Orchestration Steps"
              value={String(steps.length)}
              description={`${Object.values(stepTypeCount).filter((count) => count > 0).length} active step types`}
            />
            <HeroStat
              label="Execution Success"
              value={successRate}
              description={executions.length > 0 ? `${completedExecutions}/${executions.length} completed` : 'No executions yet'}
            />
            <HeroStat
              label="Live Triggers"
              value={String(enabledTriggerCount)}
              description={`${triggers.length} total configured`}
            />
            <HeroStat
              label="Pending Mutations"
              value={String(pendingProposals)}
              description={pendingProposals > 0 ? 'Review recommended' : 'All clear'}
            />
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <div className="space-y-6">
          <Card className="overflow-hidden border-neutral-200/80 dark:border-neutral-700/80">
            <CardHeader className="border-b border-neutral-100 bg-gradient-to-r from-amber-50/80 to-cyan-50/70 dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-900">
              <CardTitle className="text-lg">Workflow Map</CardTitle>
              <CardDescription>
                {steps.length} steps orchestrated across {Object.values(stepTypeCount).filter((count) => count > 0).length} execution primitives.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              {steps.length > 0 ? (
                <div className="space-y-3">
                  {steps.map((step, index) => (
                    <WorkflowStepRow
                      key={step.id}
                      workflow={workflow}
                      step={step}
                      index={index}
                      isLast={index === steps.length - 1}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-5 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
                  No steps defined in this workflow.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-neutral-200/80 dark:border-neutral-700/80">
            <CardHeader className="border-b border-neutral-100 bg-gradient-to-r from-cyan-50/70 to-neutral-50 dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-900">
              <CardTitle className="text-lg">Recent Executions</CardTitle>
              <CardDescription>Live run history with per-step traces and approval checkpoints.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              {executionsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))}
                </div>
              ) : executions.length > 0 ? (
                <div className="space-y-3">
                  {executions.slice(0, 10).map((execution) => (
                    <ExecutionRow key={execution.id} execution={execution} />
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-5 text-sm text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
                  No executions yet. Run the workflow to see execution history.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden border-neutral-200/80 dark:border-neutral-700/80">
            <CardHeader className="border-b border-neutral-100 bg-gradient-to-r from-neutral-50 to-amber-50/60 dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-900">
              <CardTitle className="text-lg">Details</CardTitle>
              <CardDescription>Runtime metadata and deployment posture.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 sm:p-5">
              <DetailRow
                label="Status"
                value={(
                  <Badge variant={workflow.enabled ? 'success' : 'secondary'}>
                    {workflow.enabled ? 'Active' : 'Disabled'}
                  </Badge>
                )}
              />
              <DetailRow label="Version" value={<span className="font-medium text-neutral-900 dark:text-neutral-100">{workflow.version}</span>} />
              {workflow.slug && (
                <DetailRow
                  label="Slug"
                  value={<code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">{workflow.slug}</code>}
                />
              )}
              <DetailRow
                label="Updated"
                value={<span className="text-neutral-900 dark:text-neutral-100">{formatRelativeTime(workflow.updatedAt)}</span>}
              />
            </CardContent>
          </Card>

          <WorkflowTriggerManager workflowId={workflowId} triggers={triggers} />

          <Card className="overflow-hidden border-neutral-200/80 dark:border-neutral-700/80">
            <CardHeader className="border-b border-neutral-100 bg-gradient-to-r from-neutral-50 to-emerald-50/60 dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-900">
              <CardTitle className="text-lg">Mutation Proposals</CardTitle>
              <CardDescription>
                Review and apply workflow self-modification proposals.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              {proposalsLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : proposals.length > 0 ? (
                <div className="space-y-2.5">
                  {proposals.slice(0, 8).map((proposal) => (
                    <div
                      key={proposal.id}
                      className="rounded-xl border border-neutral-200 bg-white/80 p-3 dark:border-neutral-700 dark:bg-neutral-900/80"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="font-mono text-xs text-neutral-900 dark:text-neutral-100">
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
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
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

          <Card className="overflow-hidden border-neutral-200/80 dark:border-neutral-700/80">
            <CardHeader className="border-b border-neutral-100 bg-gradient-to-r from-neutral-50 to-cyan-50/40 dark:border-neutral-800 dark:from-neutral-900 dark:to-neutral-900">
              <CardTitle className="text-lg">Version History</CardTitle>
              <CardDescription>
                Immutable workflow snapshots for one-click rollback.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 sm:p-5">
              {historyLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : history.length > 0 ? (
                <div className="space-y-2.5">
                  {history.slice(0, 8).map((entry) => {
                    const isCurrent = historyData?.currentWorkflowHash === entry.workflowHash;
                    return (
                      <div
                        key={entry.id}
                        className={cn(
                          'rounded-xl border p-3',
                          isCurrent
                            ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/20'
                            : 'border-neutral-200 bg-white/80 dark:border-neutral-700 dark:bg-neutral-900/80',
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs text-neutral-900 dark:text-neutral-100">
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
                            {isCurrent ? 'Current' : 'Rollback'}
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

function WorkflowStepRow({
  workflow,
  step,
  index,
  isLast,
}: {
  workflow: NonNullable<ReturnType<typeof useWorkflow>['data']>['workflow'];
  step: WorkflowStep;
  index: number;
  isLast: boolean;
}) {
  const childSteps = countNestedSteps(step);

  return (
    <div className="relative pl-10">
      {!isLast && (
        <span className="absolute left-[13px] top-8 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-neutral-300 to-neutral-100 dark:from-neutral-700 dark:to-neutral-900" />
      )}
      <span className="absolute left-0 top-1.5 inline-flex size-7 items-center justify-center rounded-full border border-neutral-300 bg-white text-xs font-semibold text-neutral-700 shadow-sm dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200">
        {index + 1}
      </span>

      <div className="group rounded-xl border border-neutral-200 bg-gradient-to-br from-white to-neutral-50 p-3.5 transition-all hover:border-neutral-300 hover:shadow-sm dark:border-neutral-700 dark:from-neutral-900 dark:to-neutral-900/80 dark:hover:border-neutral-600">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <StepTypeIcon type={step.type} className="size-3.5" />
              </span>
              <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {step.name}
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {step.type}
              </Badge>
              {step.outputVariable && (
                <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                  {step.outputVariable}
                </span>
              )}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              {step.tool && (
                <code className="rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                  {step.tool}
                </code>
              )}
              {childSteps > 0 && (
                <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
                  {childSteps} nested
                </span>
              )}
              {step.condition !== undefined && step.condition !== null && (
                <span className="rounded-md border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-[11px] text-cyan-700 dark:border-cyan-700/40 dark:bg-cyan-900/20 dark:text-cyan-300">
                  conditional branch
                </span>
              )}
            </div>

            {step.goal && (
              <p className="mt-2 line-clamp-2 text-sm text-neutral-600 dark:text-neutral-300">
                {step.goal}
              </p>
            )}
          </div>

          <EditWorkflowStepDialog
            workflow={workflow}
            step={step}
            stepIndex={index}
            trigger={(
              <button
                type="button"
                className="rounded-md p-1.5 text-neutral-400 opacity-60 transition hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                aria-label={`Edit ${step.name}`}
              >
                <EditIcon className="size-4" />
              </button>
            )}
          />
        </div>
      </div>
    </div>
  );
}

function ExecutionRow({ execution }: { execution: Execution }) {
  const [expanded, setExpanded] = React.useState(false);
  const { data: stepData, isLoading } = useExecutionSteps(expanded ? execution.id : '');
  const approveExecution = useApproveExecution();
  const steps = React.useMemo(
    () => [...(stepData?.steps ?? [])].sort(compareStepTraceOrder),
    [stepData?.steps],
  );

  return (
    <div className="rounded-xl border border-neutral-200 bg-gradient-to-br from-white to-neutral-50 p-3.5 dark:border-neutral-700 dark:from-neutral-900 dark:to-neutral-900/80">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ExecutionStatusBadge status={execution.status} />
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              <TriggerTypeIcon type={execution.triggerType} />
              {execution.triggerType}
            </span>
          </div>
          <p className="mt-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {execution.triggerName || `${execution.triggerType} trigger`}
          </p>
          <p className="font-mono text-xs text-neutral-500 dark:text-neutral-400">
            {execution.id.slice(0, 12)}...
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
            {formatRelativeTime(execution.startedAt)}
          </span>
          <Button size="sm" variant="secondary" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Hide Trace' : 'View Trace'}
          </Button>
        </div>
      </div>

      {execution.error && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
          {execution.error}
        </p>
      )}

      {execution.status === 'waiting_approval' && execution.resumeToken && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-700/40 dark:bg-amber-900/20">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Waiting for approval to continue this run.
          </p>
          <div className="ml-auto flex items-center gap-2">
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
          </div>
        </div>
      )}

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
          {execution.outputs && (
            <details className="rounded-lg border border-neutral-200 bg-white/70 px-2.5 py-1.5 dark:border-neutral-700 dark:bg-neutral-900/60">
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
              <div key={step.id} className="rounded-lg border border-neutral-200 bg-white/70 px-2.5 py-2 dark:border-neutral-700 dark:bg-neutral-900/60">
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
                    <StepOutputContent output={step.output} />
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

function stepTimeValue(value?: string | null): number {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function compareStepTraceOrder(
  left: {
    attempt: number;
    stepId: string;
    sequence?: number | null;
    workflowStepIndex?: number | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
  },
  right: {
    attempt: number;
    stepId: string;
    sequence?: number | null;
    workflowStepIndex?: number | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt?: string | null;
  },
): number {
  const leftSequence = typeof left.sequence === 'number' ? left.sequence : Number.MAX_SAFE_INTEGER;
  const rightSequence = typeof right.sequence === 'number' ? right.sequence : Number.MAX_SAFE_INTEGER;
  if (leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }

  if (left.attempt !== right.attempt) {
    return left.attempt - right.attempt;
  }

  const leftWorkflowIndex = typeof left.workflowStepIndex === 'number' ? left.workflowStepIndex : Number.MAX_SAFE_INTEGER;
  const rightWorkflowIndex = typeof right.workflowStepIndex === 'number' ? right.workflowStepIndex : Number.MAX_SAFE_INTEGER;
  if (leftWorkflowIndex !== rightWorkflowIndex) {
    return leftWorkflowIndex - rightWorkflowIndex;
  }

  const leftStart = stepTimeValue(left.startedAt || left.createdAt || null);
  const rightStart = stepTimeValue(right.startedAt || right.createdAt || null);
  if (leftStart !== rightStart) {
    return leftStart - rightStart;
  }

  const leftEnd = stepTimeValue(left.completedAt || left.createdAt || null);
  const rightEnd = stepTimeValue(right.completedAt || right.createdAt || null);
  if (leftEnd !== rightEnd) {
    return leftEnd - rightEnd;
  }

  return left.stepId.localeCompare(right.stepId);
}

function HeroStat({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3 backdrop-blur-sm">
      <p className="label-mono text-white/60">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-white/70">{description}</p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-neutral-50 px-3 py-2 dark:bg-neutral-900/70">
      <span className="text-xs uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{label}</span>
      <div className="text-sm">{value}</div>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function formatInlineValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return formatExecutionValue(value);
}

const COMMAND_OUTPUT_KEYS = new Set([
  'cwd',
  'command',
  'exitCode',
  'durationMs',
  'timeoutMs',
  'stdout',
  'stderr',
]);

function getCommandOutputCandidate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;

  const hasKnownKeys = Object.keys(value).some((key) => COMMAND_OUTPUT_KEYS.has(key));
  if (hasKnownKeys) return value;

  const nestedCandidates = [value.output, value.result];
  for (const nested of nestedCandidates) {
    if (!isRecord(nested)) continue;
    const nestedHasKnownKeys = Object.keys(nested).some((key) => COMMAND_OUTPUT_KEYS.has(key));
    if (nestedHasKnownKeys) return nested;
  }

  return null;
}

function OutputMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-neutral-100 px-2 py-1 dark:bg-neutral-800/80">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-0.5 truncate text-[11px] text-neutral-800 dark:text-neutral-200">{value || '—'}</p>
    </div>
  );
}

function StreamBlock({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'error';
}) {
  const containerClass = tone === 'error'
    ? 'border-red-200 bg-red-50/60 dark:border-red-900/50 dark:bg-red-950/20'
    : 'border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900/40';
  const textClass = tone === 'error'
    ? 'text-red-700 dark:text-red-300'
    : 'text-neutral-700 dark:text-neutral-200';

  return (
    <div className={cn('rounded-md border p-2', containerClass)}>
      <p className="text-[10px] font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400">{label}</p>
      <pre className={cn('mt-1 max-h-36 overflow-auto whitespace-pre-wrap text-[11px] leading-5', textClass)}>
        {value}
      </pre>
    </div>
  );
}

function StepOutputContent({ output }: { output: unknown }) {
  const commandOutput = getCommandOutputCandidate(output);

  if (commandOutput) {
    const stdout = typeof commandOutput.stdout === 'string' ? commandOutput.stdout : '';
    const stderr = typeof commandOutput.stderr === 'string' ? commandOutput.stderr : '';

    return (
      <div className="mt-2 space-y-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <OutputMetaRow label="Exit Code" value={formatInlineValue(commandOutput.exitCode)} />
          <OutputMetaRow label="Duration" value={formatInlineValue(commandOutput.durationMs)} />
          <OutputMetaRow label="Timeout" value={formatInlineValue(commandOutput.timeoutMs)} />
          <OutputMetaRow label="Working Dir" value={formatInlineValue(commandOutput.cwd)} />
        </div>

        {stdout ? <StreamBlock label="stdout" value={stdout} /> : null}
        {stderr ? <StreamBlock label="stderr" value={stderr} tone="error" /> : null}

        {!stdout && !stderr ? (
          <p className="rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900/40 dark:text-neutral-400">
            No stream output captured for this step.
          </p>
        ) : null}

        <details className="rounded border border-neutral-200 px-2 py-1 dark:border-neutral-700">
          <summary className="cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-300">
            Raw Payload
          </summary>
          <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
            {formatExecutionValue(output)}
          </pre>
        </details>
      </div>
    );
  }

  if (isRecord(output)) {
    const entries = Object.entries(output);
    const primitiveEntries = entries.filter(([, value]) => isPrimitive(value));

    if (primitiveEntries.length > 0) {
      return (
        <div className="mt-2 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {primitiveEntries.slice(0, 8).map(([key, value]) => (
              <OutputMetaRow key={key} label={key} value={formatInlineValue(value)} />
            ))}
          </div>
          <details className="rounded border border-neutral-200 px-2 py-1 dark:border-neutral-700">
            <summary className="cursor-pointer text-[11px] text-neutral-600 dark:text-neutral-300">
              Full JSON
            </summary>
            <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
              {formatExecutionValue(output)}
            </pre>
          </details>
        </div>
      );
    }
  }

  return (
    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 text-[11px] leading-5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
      {formatExecutionValue(output)}
    </pre>
  );
}

function countNestedSteps(step: WorkflowStep): number {
  const nested = step.steps?.length ?? 0;
  const thenCount = step.then?.length ?? 0;
  const elseCount = step.else?.length ?? 0;
  return nested + thenCount + elseCount;
}

function StepTypeIcon({ type, className }: { type: WorkflowStep['type']; className?: string }) {
  if (type === 'agent') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <circle cx="12" cy="8" r="4" />
        <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      </svg>
    );
  }

  if (type === 'conditional') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M6 4v16" />
        <path d="M18 4v16" />
        <path d="M6 8h12" />
        <path d="M6 16h12" />
      </svg>
    );
  }

  if (type === 'parallel') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M6 5h12" />
        <path d="M6 12h12" />
        <path d="M6 19h12" />
      </svg>
    );
  }

  if (type === 'loop') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M3 11a8 8 0 0 1 14-5" />
        <path d="M17 3v3h-3" />
        <path d="M21 13a8 8 0 0 1-14 5" />
        <path d="M7 21v-3h3" />
      </svg>
    );
  }

  if (type === 'subworkflow') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <rect x="4" y="5" width="7" height="6" rx="1" />
        <rect x="13" y="13" width="7" height="6" rx="1" />
        <path d="M11 8h2a2 2 0 0 1 2 2v3" />
      </svg>
    );
  }

  if (type === 'approval') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="m5 13 4 4L19 7" />
      </svg>
    );
  }

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M12 6v12" />
      <path d="M6 12h12" />
    </svg>
  );
}

function TriggerTypeIcon({ type }: { type: string }) {
  const iconClass = 'size-4 text-neutral-400';

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

function EditIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function WorkflowDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-64 w-full" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.85fr)]">
        <div className="space-y-6">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    </div>
  );
}
