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
  type WorkflowMutationProposal,
  type WorkflowVersionHistoryEntry,
} from '@/api/workflows';
import { useWorkflowExecutions, useExecutionSteps, useApproveExecution, type Execution } from '@/api/executions';
import { useTriggers } from '@/api/triggers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList } from '@/components/ui/tabs';
import { EditWorkflowDialog } from '@/components/workflows/edit-workflow-dialog';
import { EditWorkflowStepDialog } from '@/components/workflows/edit-workflow-step-dialog';
import { WorkflowTriggerManager } from '@/components/workflows/workflow-trigger-manager';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/cn';

export const Route = createFileRoute('/workflows/$workflowId')({
  component: WorkflowDetailPage,
});

/* ─── Execution duration helper ─── */
function executionDuration(exec: Execution): string {
  if (!exec.startedAt) return '';
  const start = new Date(exec.startedAt).getTime();
  const end = exec.completedAt ? new Date(exec.completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

/* ═══════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════ */

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

  const [selectedExecId, setSelectedExecId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState('runs');

  // Auto-select first execution, or running/pending one
  React.useEffect(() => {
    if (executions.length === 0) {
      setSelectedExecId(null);
      return;
    }
    const activeExec = executions.find(
      (e) => e.status === 'running' || e.status === 'waiting_approval' || e.status === 'pending',
    );
    if (activeExec && !selectedExecId) {
      setSelectedExecId(activeExec.id);
    } else if (!selectedExecId || !executions.find((e) => e.id === selectedExecId)) {
      setSelectedExecId(executions[0].id);
    }
  }, [executions, selectedExecId]);

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
        <div className="rounded border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm text-red-600 dark:text-red-400">
            Failed to load workflow.
          </p>
          <Link
            to="/workflows"
            className="mt-1 inline-block text-sm text-red-600 underline dark:text-red-400"
          >
            Back to workflows
          </Link>
        </div>
      </PageContainer>
    );
  }

  const steps = workflow.data.steps ?? [];
  const selectedExec = executions.find((e) => e.id === selectedExecId) ?? null;
  const pendingProposals = proposals.filter((p) => p.status === 'pending').length;

  return (
    <PageContainer className="flex h-[calc(100vh-3.5rem)] flex-col gap-0 overflow-hidden !p-0">
      {/* ─── Compact Header ─── */}
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-200 bg-surface-0 px-4 py-2.5 dark:border-neutral-800">
        <Link
          to="/workflows"
          className="text-neutral-400 transition hover:text-neutral-600 dark:hover:text-neutral-300"
          aria-label="Back to workflows"
        >
          <ChevronLeftIcon className="size-4" />
        </Link>

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <StatusIndicator status={workflow.enabled ? 'active' : 'disabled'} />
          <h1 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {workflow.name}
          </h1>
          <span className="hidden shrink-0 font-mono text-2xs text-neutral-400 sm:inline">
            v{workflow.version}
          </span>
          {workflow.slug && (
            <code className="hidden shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-2xs text-neutral-500 dark:bg-neutral-800 sm:inline">
              {workflow.slug}
            </code>
          )}
          <span className="hidden shrink-0 text-2xs text-neutral-400 lg:inline">
            {formatRelativeTime(workflow.updatedAt)}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <EditWorkflowDialog
            workflow={workflow}
            trigger={
              <Button size="sm" variant="ghost">
                <GearIcon className="size-3.5" />
              </Button>
            }
          />
          <Button
            onClick={handleRun}
            disabled={runWorkflow.isPending}
            size="sm"
            variant="primary"
          >
            {runWorkflow.isPending ? (
              <>
                <Spinner className="size-3" />
                Running
              </>
            ) : (
              <>
                <PlayIcon className="size-3" />
                Run
              </>
            )}
          </Button>
        </div>
      </header>

      {/* ─── Tab bar ─── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 bg-surface-1 px-4 dark:border-neutral-800 dark:bg-surface-1">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-9 gap-0 rounded-none border-none bg-transparent p-0">
            <TabButton value="runs" current={tab} onClick={setTab}>
              Runs
              {executions.length > 0 && (
                <span className="ml-1 rounded-full bg-neutral-200 px-1.5 text-2xs tabular-nums text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                  {executions.length}
                </span>
              )}
            </TabButton>
            <TabButton value="steps" current={tab} onClick={setTab}>
              Steps
              <span className="ml-1 rounded-full bg-neutral-200 px-1.5 text-2xs tabular-nums text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                {steps.length}
              </span>
            </TabButton>
            <TabButton value="triggers" current={tab} onClick={setTab}>
              Triggers
              {triggers.length > 0 && (
                <span className="ml-1 rounded-full bg-neutral-200 px-1.5 text-2xs tabular-nums text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
                  {triggers.length}
                </span>
              )}
            </TabButton>
            <TabButton value="proposals" current={tab} onClick={setTab}>
              Proposals
              {pendingProposals > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-2xs tabular-nums text-amber-600 dark:text-amber-400">
                  {pendingProposals}
                </span>
              )}
            </TabButton>
            <TabButton value="history" current={tab} onClick={setTab}>
              History
            </TabButton>
          </TabsList>
        </Tabs>
      </div>

      {/* ─── Content ─── */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'runs' && (
          <RunsPanel
            executions={executions}
            executionsLoading={executionsLoading}
            selectedExecId={selectedExecId}
            onSelectExec={setSelectedExecId}
            selectedExec={selectedExec}
          />
        )}

        {tab === 'steps' && (
          <div className="h-full overflow-y-auto p-4">
            <StepsPanel workflow={workflow} steps={steps} />
          </div>
        )}

        {tab === 'triggers' && (
          <div className="h-full overflow-y-auto p-4">
            <WorkflowTriggerManager workflowId={workflowId} triggers={triggers} />
          </div>
        )}

        {tab === 'proposals' && (
          <div className="h-full overflow-y-auto p-4">
            <ProposalsPanel
              proposals={proposals}
              proposalsLoading={proposalsLoading}
              workflowId={workflowId}
              reviewProposal={reviewProposal}
              applyProposal={applyProposal}
            />
          </div>
        )}

        {tab === 'history' && (
          <div className="h-full overflow-y-auto p-4">
            <HistoryPanel
              history={history}
              historyLoading={historyLoading}
              currentHash={historyData?.currentWorkflowHash}
              workflowId={workflowId}
              rollbackWorkflow={rollbackWorkflow}
            />
          </div>
        )}
      </div>
    </PageContainer>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab Button (underline style)
   ═══════════════════════════════════════════════════════════ */

function TabButton({
  value,
  current,
  onClick,
  children,
}: {
  value: string;
  current: string;
  onClick: (v: string) => void;
  children: React.ReactNode;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      className={cn(
        'inline-flex items-center border-b-2 px-3 py-2 text-xs font-medium transition-colors',
        active
          ? 'border-accent text-neutral-900 dark:text-neutral-100'
          : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
      )}
    >
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════
   Runs Panel — split layout
   ═══════════════════════════════════════════════════════════ */

function RunsPanel({
  executions,
  executionsLoading,
  selectedExecId,
  onSelectExec,
  selectedExec,
}: {
  executions: Execution[];
  executionsLoading: boolean;
  selectedExecId: string | null;
  onSelectExec: (id: string) => void;
  selectedExec: Execution | null;
}) {
  return (
    <div className="flex h-full">
      {/* Left: run list */}
      <div className="flex w-72 shrink-0 flex-col border-r border-neutral-200 dark:border-neutral-800 lg:w-80">
        <div className="shrink-0 border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
          <span className="text-2xs font-medium uppercase tracking-wider text-neutral-400">
            Recent Runs
          </span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {executionsLoading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full" />
              ))}
            </div>
          ) : executions.length > 0 ? (
            <div className="py-1">
              {executions.slice(0, 25).map((exec) => (
                <RunListItem
                  key={exec.id}
                  execution={exec}
                  isSelected={exec.id === selectedExecId}
                  onClick={() => onSelectExec(exec.id)}
                />
              ))}
            </div>
          ) : (
            <div className="px-3 py-6 text-center text-xs text-neutral-400">
              No runs yet
            </div>
          )}
        </div>
      </div>

      {/* Right: execution detail */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {selectedExec ? (
          <ExecutionDetail execution={selectedExec} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-400">
            {executions.length > 0 ? 'Select a run' : 'Run the workflow to see results'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Run list row ─── */

function RunListItem({
  execution,
  isSelected,
  onClick,
}: {
  execution: Execution;
  isSelected: boolean;
  onClick: () => void;
}) {
  const isActive = execution.status === 'running' || execution.status === 'pending';
  const isWaiting = execution.status === 'waiting_approval';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors',
        isSelected
          ? 'bg-accent/8 dark:bg-accent/10'
          : 'hover:bg-neutral-50 dark:hover:bg-neutral-900/50',
        isActive && !isSelected && 'bg-blue-50/50 dark:bg-blue-950/20',
        isWaiting && !isSelected && 'bg-amber-50/50 dark:bg-amber-950/20',
      )}
    >
      <ExecStatusIcon status={execution.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
            {execution.triggerName || execution.triggerType}
          </span>
        </div>
        <div className="flex items-center gap-2 text-2xs text-neutral-400">
          <span className="tabular-nums">{formatRelativeTime(execution.startedAt)}</span>
          <span className="tabular-nums">{executionDuration(execution)}</span>
        </div>
      </div>
      <TriggerTypePill type={execution.triggerType} />
    </button>
  );
}

/* ─── Execution detail (right panel) ─── */

function ExecutionDetail({ execution }: { execution: Execution }) {
  const { data: stepData, isLoading } = useExecutionSteps(execution.id);
  const approveExecution = useApproveExecution();
  const steps = React.useMemo(
    () => [...(stepData?.steps ?? [])].sort(compareStepTraceOrder),
    [stepData?.steps],
  );

  const isActive = execution.status === 'running' || execution.status === 'pending';

  return (
    <div className="flex flex-col">
      {/* Execution header */}
      <div className="shrink-0 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2.5">
          <ExecStatusIcon status={execution.status} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                {execution.triggerName || `${execution.triggerType} trigger`}
              </span>
              <ExecStatusBadge status={execution.status} />
              {isActive && (
                <span className="inline-flex items-center gap-1 text-2xs text-blue-600 dark:text-blue-400">
                  <Spinner className="size-2.5" />
                  Running
                </span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-3 font-mono text-2xs text-neutral-400">
              <span>{execution.id.slice(0, 12)}</span>
              <span>{formatRelativeTime(execution.startedAt)}</span>
              <span>{executionDuration(execution)}</span>
            </div>
          </div>
        </div>

        {execution.error && (
          <div className="mt-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 font-mono text-2xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            {execution.error}
          </div>
        )}

        {execution.status === 'waiting_approval' && execution.resumeToken && (
          <div className="mt-2 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 dark:border-amber-800/50 dark:bg-amber-950/20">
            <span className="flex-1 text-xs font-medium text-amber-800 dark:text-amber-300">
              Waiting for approval
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={approveExecution.isPending}
              onClick={() => approveExecution.mutate({
                executionId: execution.id,
                data: { approve: false, resumeToken: execution.resumeToken!, reason: 'approval_denied' },
              })}
              className="text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              Deny
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={approveExecution.isPending}
              onClick={() => approveExecution.mutate({
                executionId: execution.id,
                data: { approve: true, resumeToken: execution.resumeToken! },
              })}
            >
              Approve
            </Button>
          </div>
        )}
      </div>

      {/* Execution output */}
      {execution.outputs && (
        <CollapsibleSection title="Execution Output" defaultOpen={false}>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-5 text-neutral-600 dark:text-neutral-300">
            {formatExecutionValue(execution.outputs)}
          </pre>
        </CollapsibleSection>
      )}

      {/* Step traces */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : steps.length > 0 ? (
          <div className="py-1">
            {steps.map((step, i) => (
              <StepTraceRow key={step.id} step={step} isLast={i === steps.length - 1} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-xs text-neutral-400">
            No step traces captured yet
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Step trace row (GH Actions style) ─── */

function StepTraceRow({
  step,
  isLast,
}: {
  step: {
    id: string;
    stepId: string;
    attempt: number;
    status: string;
    output: unknown;
    error: string | null;
    startedAt: string | null;
    completedAt: string | null;
  };
  isLast: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const hasOutput = step.output !== null && step.output !== undefined;
  const hasError = !!step.error;
  const isExpandable = hasOutput || hasError;
  const duration = step.startedAt
    ? (() => {
        const start = new Date(step.startedAt).getTime();
        const end = step.completedAt ? new Date(step.completedAt).getTime() : Date.now();
        const ms = end - start;
        if (ms < 1000) return `${ms}ms`;
        return `${(ms / 1000).toFixed(1)}s`;
      })()
    : null;

  return (
    <div className="group">
      <button
        type="button"
        onClick={() => isExpandable && setExpanded(!expanded)}
        disabled={!isExpandable}
        className={cn(
          'flex w-full items-center gap-2 px-4 py-1.5 text-left transition-colors',
          isExpandable && 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/50',
          !isExpandable && 'cursor-default',
          expanded && 'bg-neutral-50/50 dark:bg-neutral-900/30',
        )}
      >
        {/* Status dot + connector */}
        <div className="relative flex flex-col items-center">
          <StepStatusDot status={step.status} />
          {!isLast && (
            <div className="absolute top-4 h-3 w-px bg-neutral-200 dark:bg-neutral-700" />
          )}
        </div>

        {/* Expand chevron */}
        {isExpandable ? (
          <ChevronIcon
            className={cn(
              'size-3 shrink-0 text-neutral-400 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}

        {/* Step name */}
        <span className={cn(
          'flex-1 truncate text-xs',
          step.status === 'failed'
            ? 'font-medium text-red-600 dark:text-red-400'
            : 'text-neutral-700 dark:text-neutral-300',
        )}>
          {step.stepId}
          {step.attempt > 1 && (
            <span className="ml-1 text-2xs text-neutral-400">(attempt {step.attempt})</span>
          )}
        </span>

        {/* Duration */}
        {duration && (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-neutral-400">
            {duration}
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="border-l-2 border-neutral-200 ml-[1.15rem] mr-4 mb-1 dark:border-neutral-700">
          {hasError && (
            <div className="bg-red-50 px-3 py-1.5 font-mono text-2xs text-red-600 dark:bg-red-950/20 dark:text-red-400">
              {step.error}
            </div>
          )}
          {hasOutput && (
            <StepOutputCompact output={step.output} />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Compact step output ─── */

function StepOutputCompact({ output }: { output: unknown }) {
  const commandOutput = getCommandOutputCandidate(output);

  if (commandOutput) {
    const stdout = typeof commandOutput.stdout === 'string' ? commandOutput.stdout : '';
    const stderr = typeof commandOutput.stderr === 'string' ? commandOutput.stderr : '';
    const exitCode = commandOutput.exitCode;
    const durationMs = commandOutput.durationMs;

    return (
      <div className="text-2xs">
        {/* Compact meta line */}
        <div className="flex items-center gap-3 border-b border-neutral-100 bg-neutral-50/50 px-3 py-1 font-mono text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/30 dark:text-neutral-400">
          {exitCode !== undefined && exitCode !== null && (
            <span className={cn(exitCode === 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
              exit {String(exitCode)}
            </span>
          )}
          {durationMs !== undefined && durationMs !== null && (
            <span>{Number(durationMs) < 1000 ? `${durationMs}ms` : `${(Number(durationMs) / 1000).toFixed(1)}s`}</span>
          )}
          {typeof commandOutput.cwd === 'string' && commandOutput.cwd && (
            <span className="truncate">{commandOutput.cwd}</span>
          )}
        </div>
        {stdout && (
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap bg-neutral-950 px-3 py-2 font-mono text-2xs leading-5 text-emerald-300 dark:bg-neutral-950">
            {stdout}
          </pre>
        )}
        {stderr && (
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap bg-red-950/80 px-3 py-2 font-mono text-2xs leading-5 text-red-300">
            {stderr}
          </pre>
        )}
        {!stdout && !stderr && (
          <div className="px-3 py-1.5 text-neutral-400">No output</div>
        )}
      </div>
    );
  }

  // Generic JSON output
  return (
    <pre className="max-h-52 overflow-auto whitespace-pre-wrap bg-neutral-950 px-3 py-2 font-mono text-2xs leading-5 text-neutral-300 dark:bg-neutral-950">
      {formatExecutionValue(output)}
    </pre>
  );
}

/* ═══════════════════════════════════════════════════════════
   Steps Panel (workflow definition)
   ═══════════════════════════════════════════════════════════ */

function StepsPanel({
  workflow,
  steps,
}: {
  workflow: NonNullable<ReturnType<typeof useWorkflow>['data']>['workflow'];
  steps: WorkflowStep[];
}) {
  if (steps.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-neutral-400">
        No steps defined in this workflow.
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {steps.map((step, index) => (
        <CompactStepRow
          key={step.id}
          workflow={workflow}
          step={step}
          index={index}
          isLast={index === steps.length - 1}
        />
      ))}
    </div>
  );
}

function CompactStepRow({
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
  const [expanded, setExpanded] = React.useState(false);
  const childSteps = countNestedSteps(step);
  const hasDetails = !!(
    step.goal || step.context || step.tool || step.arguments ||
    step.condition || step.outputVariable ||
    (step.then && step.then.length > 0) ||
    (step.else && step.else.length > 0) ||
    (step.steps && step.steps.length > 0)
  );

  return (
    <div>
      <div className="group relative flex items-center gap-3 rounded px-3 py-2 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900/50">
        {/* Step number + connector */}
        <div className="relative flex flex-col items-center self-start pt-0.5">
          <span className="inline-flex size-6 items-center justify-center rounded-full border border-neutral-200 bg-surface-0 font-mono text-2xs font-semibold text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
            {index + 1}
          </span>
          {!isLast && (
            <div className="absolute top-6 h-[calc(100%+0.25rem)] w-px bg-neutral-200 dark:bg-neutral-700" />
          )}
        </div>

        {/* Expand chevron */}
        {hasDetails ? (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <ChevronIcon className={cn('size-3 transition-transform', expanded && 'rotate-90')} />
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        {/* Type icon */}
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          <StepTypeIcon type={step.type} className="size-3" />
        </span>

        {/* Name + metadata */}
        <button
          type="button"
          onClick={() => hasDetails && setExpanded(!expanded)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium text-neutral-900 dark:text-neutral-100">
              {step.name}
            </span>
            <Badge variant="secondary" className="text-[9px]">
              {step.type}
            </Badge>
            {step.tool && (
              <code className="hidden rounded bg-neutral-100 px-1 py-px font-mono text-[9px] text-neutral-500 dark:bg-neutral-800 sm:inline">
                {step.tool}
              </code>
            )}
            {step.outputVariable && (
              <span className="hidden rounded bg-cyan-500/10 px-1 py-px font-mono text-[9px] text-cyan-600 dark:text-cyan-400 sm:inline">
                ${step.outputVariable}
              </span>
            )}
            {childSteps > 0 && (
              <span className="text-[9px] text-amber-600 dark:text-amber-400">{childSteps} nested</span>
            )}
          </div>
          {step.goal && (
            <p className={cn('mt-0.5 text-2xs text-neutral-400', !expanded && 'truncate')}>
              {step.goal}
            </p>
          )}
        </button>

        {/* Edit button */}
        <EditWorkflowStepDialog
          workflow={workflow}
          step={step}
          stepIndex={index}
          trigger={
            <button
              type="button"
              className="shrink-0 rounded p-1 text-neutral-400 opacity-0 transition hover:bg-neutral-100 hover:text-neutral-600 group-hover:opacity-100 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
              aria-label={`Edit ${step.name}`}
            >
              <EditIcon className="size-3.5" />
            </button>
          }
        />
      </div>

      {/* Expanded detail panel */}
      {expanded && hasDetails && (
        <StepDetailPanel step={step} />
      )}
    </div>
  );
}

/* ─── Step detail panel (inline expansion) ─── */

function StepDetailPanel({ step }: { step: WorkflowStep }) {
  return (
    <div className="ml-[2.65rem] mr-3 mb-2 rounded border border-neutral-200 bg-neutral-50/50 dark:border-neutral-700 dark:bg-neutral-900/30">
      <div className="divide-y divide-neutral-200 dark:divide-neutral-700/50">
        {/* Goal / Context */}
        {step.goal && (
          <StepDetailField label="Goal">
            <p className="text-xs text-neutral-700 dark:text-neutral-300">{step.goal}</p>
          </StepDetailField>
        )}
        {step.context && (
          <StepDetailField label="Context">
            <p className="text-xs text-neutral-700 dark:text-neutral-300">{step.context}</p>
          </StepDetailField>
        )}

        {/* Tool + Arguments */}
        {step.tool && (
          <StepDetailField label="Tool">
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-2xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
              {step.tool}
            </code>
          </StepDetailField>
        )}
        {step.arguments && Object.keys(step.arguments).length > 0 && (
          <StepDetailField label="Arguments">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 px-2.5 py-2 font-mono text-2xs leading-5 text-emerald-300">
              {JSON.stringify(step.arguments, null, 2)}
            </pre>
          </StepDetailField>
        )}

        {/* Output variable */}
        {step.outputVariable && (
          <StepDetailField label="Output Variable">
            <code className="rounded bg-cyan-500/10 px-1.5 py-0.5 font-mono text-2xs text-cyan-700 dark:text-cyan-300">
              {step.outputVariable}
            </code>
          </StepDetailField>
        )}

        {/* Condition (conditional steps) */}
        {step.condition !== undefined && step.condition !== null && (
          <StepDetailField label="Condition">
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 px-2.5 py-2 font-mono text-2xs leading-5 text-amber-300">
              {JSON.stringify(step.condition, null, 2)}
            </pre>
          </StepDetailField>
        )}

        {/* Then / Else branches */}
        {step.then && step.then.length > 0 && (
          <StepDetailField label={`Then Branch (${step.then.length} steps)`}>
            <NestedStepList steps={step.then} />
          </StepDetailField>
        )}
        {step.else && step.else.length > 0 && (
          <StepDetailField label={`Else Branch (${step.else.length} steps)`}>
            <NestedStepList steps={step.else} />
          </StepDetailField>
        )}

        {/* Nested steps (parallel/loop/subworkflow) */}
        {step.steps && step.steps.length > 0 && (
          <StepDetailField label={`Nested Steps (${step.steps.length})`}>
            <NestedStepList steps={step.steps} />
          </StepDetailField>
        )}
      </div>
    </div>
  );
}

function StepDetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2">
      <p className="mb-1 font-mono text-[9px] font-semibold uppercase tracking-wider text-neutral-400">
        {label}
      </p>
      {children}
    </div>
  );
}

function NestedStepList({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="space-y-1">
      {steps.map((nested, i) => (
        <div key={nested.id || i} className="flex items-center gap-2 rounded bg-neutral-100 px-2 py-1.5 dark:bg-neutral-800/50">
          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-neutral-200 font-mono text-[8px] font-semibold text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
            {i + 1}
          </span>
          <span className="inline-flex size-4 shrink-0 items-center justify-center rounded bg-neutral-200 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
            <StepTypeIcon type={nested.type} className="size-2.5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-2xs font-medium text-neutral-700 dark:text-neutral-300">
            {nested.name}
          </span>
          <Badge variant="secondary" className="text-[8px]">{nested.type}</Badge>
          {nested.tool && (
            <code className="font-mono text-[8px] text-neutral-400">{nested.tool}</code>
          )}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Proposals Panel
   ═══════════════════════════════════════════════════════════ */

function ProposalsPanel({
  proposals,
  proposalsLoading,
  workflowId,
  reviewProposal,
  applyProposal,
}: {
  proposals: WorkflowMutationProposal[];
  proposalsLoading: boolean;
  workflowId: string;
  reviewProposal: ReturnType<typeof useReviewWorkflowProposal>;
  applyProposal: ReturnType<typeof useApplyWorkflowProposal>;
}) {
  if (proposalsLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-neutral-400">
        No mutation proposals.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {proposals.slice(0, 12).map((proposal) => (
        <div
          key={proposal.id}
          className="flex items-center gap-3 rounded border border-neutral-200 bg-surface-0 px-3 py-2 dark:border-neutral-700"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <code className="font-mono text-2xs text-neutral-600 dark:text-neutral-300">
                {proposal.id.slice(0, 10)}
              </code>
              <ProposalStatusBadge status={proposal.status} />
            </div>
            <p className="mt-0.5 text-2xs text-neutral-400">
              {formatRelativeTime(proposal.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-1">
            {proposal.status === 'pending' && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={reviewProposal.isPending}
                  onClick={() => reviewProposal.mutate({ workflowId, proposalId: proposal.id, data: { approve: false } })}
                  className="text-red-600 dark:text-red-400"
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
            {proposal.status === 'approved' && (
              <Button
                size="sm"
                variant="primary"
                disabled={applyProposal.isPending}
                onClick={() => applyProposal.mutate({ workflowId, proposalId: proposal.id })}
              >
                Apply
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   History Panel
   ═══════════════════════════════════════════════════════════ */

function HistoryPanel({
  history,
  historyLoading,
  currentHash,
  workflowId,
  rollbackWorkflow,
}: {
  history: WorkflowVersionHistoryEntry[];
  historyLoading: boolean;
  currentHash: string | undefined;
  workflowId: string;
  rollbackWorkflow: ReturnType<typeof useRollbackWorkflowVersion>;
}) {
  if (historyLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-neutral-400">
        No version history.
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {history.slice(0, 12).map((entry) => {
        const isCurrent = currentHash === entry.workflowHash;
        return (
          <div
            key={entry.id}
            className={cn(
              'flex items-center gap-3 rounded border px-3 py-2',
              isCurrent
                ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800/40 dark:bg-emerald-950/10'
                : 'border-neutral-200 bg-surface-0 dark:border-neutral-700',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <code className="truncate font-mono text-2xs text-neutral-600 dark:text-neutral-300">
                  {entry.workflowHash.slice(0, 16)}
                </code>
                {isCurrent && (
                  <span className="rounded bg-emerald-500/10 px-1.5 py-px text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                    current
                  </span>
                )}
                <Badge variant="secondary" className="text-[9px]">{entry.source}</Badge>
              </div>
              <p className="mt-0.5 text-2xs text-neutral-400">
                {formatRelativeTime(entry.createdAt)}
              </p>
            </div>
            {!isCurrent && (
              <Button
                size="sm"
                variant="secondary"
                disabled={rollbackWorkflow.isPending}
                onClick={() => rollbackWorkflow.mutate({ workflowId, data: { targetWorkflowHash: entry.workflowHash } })}
              >
                Rollback
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Collapsible Section
   ═══════════════════════════════════════════════════════════ */

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="border-b border-neutral-100 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-900/30"
      >
        <ChevronIcon className={cn('size-3 text-neutral-400 transition-transform', open && 'rotate-90')} />
        <span className="text-2xs font-medium uppercase tracking-wider text-neutral-500">{title}</span>
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Status helpers
   ═══════════════════════════════════════════════════════════ */

function StatusIndicator({ status }: { status: 'active' | 'disabled' }) {
  return (
    <span
      className={cn(
        'inline-block size-2 rounded-full',
        status === 'active' ? 'bg-emerald-500 animate-pulse-dot' : 'bg-neutral-300 dark:bg-neutral-600',
      )}
    />
  );
}

function ExecStatusIcon({ status, size = 'sm' }: { status: string; size?: 'sm' | 'md' }) {
  const s = size === 'md' ? 'size-5' : 'size-4';
  const dot = size === 'md' ? 'size-2' : 'size-1.5';

  if (status === 'completed') {
    return (
      <span className={cn(s, 'inline-flex items-center justify-center rounded-full bg-emerald-500/10')}>
        <CheckIcon className={cn(dot, 'text-emerald-600 dark:text-emerald-400')} />
      </span>
    );
  }

  if (status === 'failed') {
    return (
      <span className={cn(s, 'inline-flex items-center justify-center rounded-full bg-red-500/10')}>
        <XIcon className={cn(dot, 'text-red-600 dark:text-red-400')} />
      </span>
    );
  }

  if (status === 'running' || status === 'pending') {
    return (
      <span className={cn(s, 'inline-flex items-center justify-center rounded-full bg-blue-500/10')}>
        <Spinner className={cn(dot, 'text-blue-600 dark:text-blue-400')} />
      </span>
    );
  }

  if (status === 'waiting_approval') {
    return (
      <span className={cn(s, 'inline-flex items-center justify-center rounded-full bg-amber-500/10')}>
        <span className={cn(dot, 'rounded-full bg-amber-500 animate-pulse-dot')} />
      </span>
    );
  }

  if (status === 'cancelled') {
    return (
      <span className={cn(s, 'inline-flex items-center justify-center rounded-full bg-neutral-500/10')}>
        <span className={cn(dot, 'rounded-full bg-neutral-400')} />
      </span>
    );
  }

  return (
    <span className={cn(s, 'inline-flex items-center justify-center rounded-full bg-neutral-500/10')}>
      <span className={cn(dot, 'rounded-full bg-neutral-400')} />
    </span>
  );
}

function ExecStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
    pending: 'warning',
    running: 'default',
    waiting_approval: 'warning',
    completed: 'success',
    cancelled: 'secondary',
    failed: 'error',
  };
  return <Badge variant={variants[status] ?? 'secondary'} className="text-[9px]">{status.replace('_', ' ')}</Badge>;
}

function StepStatusDot({ status }: { status: string }) {
  if (status === 'completed') {
    return <span className="size-2.5 rounded-full bg-emerald-500" />;
  }
  if (status === 'failed') {
    return <span className="size-2.5 rounded-full bg-red-500" />;
  }
  if (status === 'running') {
    return <span className="size-2.5 rounded-full bg-blue-500 animate-pulse-dot" />;
  }
  if (status === 'waiting_approval') {
    return <span className="size-2.5 rounded-full bg-amber-500 animate-pulse-dot" />;
  }
  return <span className="size-2.5 rounded-full bg-neutral-300 dark:bg-neutral-600" />;
}

function ProposalStatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'success' | 'warning' | 'error' | 'secondary'> = {
    pending: 'warning',
    approved: 'success',
    rejected: 'error',
    applied: 'success',
    failed: 'error',
  };
  return <Badge variant={variants[status] ?? 'secondary'} className="text-[9px]">{status}</Badge>;
}

function TriggerTypePill({ type }: { type: string }) {
  return (
    <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[9px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
      {type}
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════
   Utility functions (preserved from original)
   ═══════════════════════════════════════════════════════════ */

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
  if (leftSequence !== rightSequence) return leftSequence - rightSequence;
  if (left.attempt !== right.attempt) return left.attempt - right.attempt;
  const leftWorkflowIndex = typeof left.workflowStepIndex === 'number' ? left.workflowStepIndex : Number.MAX_SAFE_INTEGER;
  const rightWorkflowIndex = typeof right.workflowStepIndex === 'number' ? right.workflowStepIndex : Number.MAX_SAFE_INTEGER;
  if (leftWorkflowIndex !== rightWorkflowIndex) return leftWorkflowIndex - rightWorkflowIndex;
  const leftStart = stepTimeValue(left.startedAt || left.createdAt || null);
  const rightStart = stepTimeValue(right.startedAt || right.createdAt || null);
  if (leftStart !== rightStart) return leftStart - rightStart;
  const leftEnd = stepTimeValue(left.completedAt || left.createdAt || null);
  const rightEnd = stepTimeValue(right.completedAt || right.createdAt || null);
  if (leftEnd !== rightEnd) return leftEnd - rightEnd;
  return left.stepId.localeCompare(right.stepId);
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

const COMMAND_OUTPUT_KEYS = new Set([
  'cwd', 'command', 'exitCode', 'durationMs', 'timeoutMs', 'stdout', 'stderr',
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

function countNestedSteps(step: WorkflowStep): number {
  return (step.steps?.length ?? 0) + (step.then?.length ?? 0) + (step.else?.length ?? 0);
}

/* ═══════════════════════════════════════════════════════════
   Icons
   ═══════════════════════════════════════════════════════════ */

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function PlayIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className}>
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function GearIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

function EditIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
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
  if (type === 'agent_message') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  if (type === 'conditional') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M6 4v16" /><path d="M18 4v16" /><path d="M6 8h12" /><path d="M6 16h12" />
      </svg>
    );
  }
  if (type === 'parallel') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M6 5h12" /><path d="M6 12h12" /><path d="M6 19h12" />
      </svg>
    );
  }
  if (type === 'loop') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <path d="M3 11a8 8 0 0 1 14-5" /><path d="M17 3v3h-3" /><path d="M21 13a8 8 0 0 1-14 5" /><path d="M7 21v-3h3" />
      </svg>
    );
  }
  if (type === 'subworkflow') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
        <rect x="4" y="5" width="7" height="6" rx="1" /><rect x="13" y="13" width="7" height="6" rx="1" /><path d="M11 8h2a2 2 0 0 1 2 2v3" />
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
      <path d="M12 6v12" /><path d="M6 12h12" />
    </svg>
  );
}

/* ─── Skeleton ─── */

function WorkflowDetailSkeleton() {
  return (
    <div className="space-y-0">
      <Skeleton className="h-11 w-full" />
      <Skeleton className="h-9 w-full" />
      <div className="flex">
        <Skeleton className="h-96 w-72" />
        <Skeleton className="h-96 flex-1" />
      </div>
    </div>
  );
}
