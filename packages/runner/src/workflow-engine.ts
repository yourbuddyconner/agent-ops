import type { NormalizedWorkflowDefinition, NormalizedWorkflowStep } from './workflow-compiler.js';

export type WorkflowStatus = 'ok' | 'needs_approval' | 'cancelled' | 'failed';

export interface WorkflowRunPayload {
  trigger?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  runtime?: {
    attempt?: number;
    idempotencyKey?: string;
    policy?: {
      maxSteps?: number;
    };
  };
}

export interface WorkflowStepResult {
  stepId: string;
  status: string;
  attempt: number;
  startedAt: string;
  completedAt?: string;
  output?: unknown;
  error?: string;
}

export interface WorkflowRunEnvelope {
  ok: boolean;
  status: WorkflowStatus;
  executionId: string;
  output: Record<string, unknown>;
  steps: WorkflowStepResult[];
  requiresApproval: null | {
    stepId: string;
    prompt: string;
    items: unknown[];
    resumeToken: string;
  };
  error: string | null;
}

export interface WorkflowEvent {
  type: string;
  executionId: string;
  ts: string;
  [key: string]: unknown;
}

type EventSink = (event: WorkflowEvent) => void;

type ExecutionContext = {
  executionId: string;
  attempt: number;
  variables: Record<string, unknown>;
  outputs: Record<string, unknown>;
  steps: WorkflowStepResult[];
  maxSteps: number;
  visitedSteps: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function emit(sink: EventSink | undefined, event: WorkflowEvent): void {
  if (!sink) return;
  sink(event);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function asStepArray(value: unknown): NormalizedWorkflowStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is NormalizedWorkflowStep => !!entry && typeof entry === 'object' && typeof (entry as Record<string, unknown>).id === 'string')
    .sort((a, b) => a.id.localeCompare(b.id));
}

function evaluateCondition(step: NormalizedWorkflowStep, ctx: ExecutionContext): boolean {
  const condition = step.condition;
  if (typeof condition === 'boolean') return condition;

  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    const conditionObj = condition as Record<string, unknown>;
    const variableName = conditionObj.variable;
    if (typeof variableName === 'string') {
      const current = ctx.variables[variableName] ?? ctx.outputs[variableName];
      if (Object.prototype.hasOwnProperty.call(conditionObj, 'equals')) {
        return current === conditionObj.equals;
      }
      return Boolean(current);
    }
  }

  return false;
}

function stepOutputVariable(step: NormalizedWorkflowStep): string | null {
  const value = step.outputVariable;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function createApprovalToken(executionId: string, stepId: string, attempt: number): Promise<string> {
  return sha256Hex(`${executionId}:${stepId}:${attempt}`).then((digest) => `wrf_rt_${digest.slice(0, 24)}`);
}

async function executeSteps(
  steps: NormalizedWorkflowStep[],
  ctx: ExecutionContext,
  sink: EventSink | undefined,
): Promise<{ approval?: WorkflowRunEnvelope['requiresApproval']; failed?: string }> {
  for (const step of steps) {
    if (ctx.visitedSteps >= ctx.maxSteps) {
      return { failed: `max_steps_exceeded:${ctx.maxSteps}` };
    }

    ctx.visitedSteps += 1;
    const startedAt = nowIso();
    const result: WorkflowStepResult = {
      stepId: step.id,
      status: 'running',
      attempt: ctx.attempt,
      startedAt,
    };

    ctx.steps.push(result);
    emit(sink, { type: 'step.started', executionId: ctx.executionId, stepId: step.id, attempt: ctx.attempt, ts: startedAt });

    if (step.type === 'approval') {
      const prompt = typeof step.prompt === 'string' && step.prompt.trim()
        ? step.prompt.trim()
        : `Approval required for step ${step.id}`;
      const resumeToken = await createApprovalToken(ctx.executionId, step.id, ctx.attempt);
      const approvalAt = nowIso();

      result.status = 'waiting_approval';
      result.completedAt = approvalAt;
      result.output = { prompt };

      emit(sink, {
        type: 'approval.required',
        executionId: ctx.executionId,
        stepId: step.id,
        attempt: ctx.attempt,
        resumeToken,
        ts: approvalAt,
      });

      return {
        approval: {
          stepId: step.id,
          prompt,
          items: [],
          resumeToken,
        },
      };
    }

    if (step.type === 'conditional') {
      const conditionResult = evaluateCondition(step, ctx);
      const branchSteps = conditionResult ? asStepArray(step.then) : asStepArray(step.else);
      const branchRun = await executeSteps(branchSteps, ctx, sink);

      const completedAt = nowIso();
      result.status = 'completed';
      result.completedAt = completedAt;
      result.output = {
        condition: conditionResult,
        branch: conditionResult ? 'then' : 'else',
      };

      emit(sink, { type: 'step.completed', executionId: ctx.executionId, stepId: step.id, attempt: ctx.attempt, ts: completedAt });

      if (branchRun.approval || branchRun.failed) return branchRun;
      continue;
    }

    if (step.type === 'parallel') {
      const branches = asStepArray(step.steps);
      const branchRun = await executeSteps(branches, ctx, sink);

      const completedAt = nowIso();
      result.status = 'completed';
      result.completedAt = completedAt;
      result.output = { branchCount: branches.length };

      emit(sink, { type: 'step.completed', executionId: ctx.executionId, stepId: step.id, attempt: ctx.attempt, ts: completedAt });

      if (branchRun.approval || branchRun.failed) return branchRun;
      continue;
    }

    try {
      const stepOut: Record<string, unknown> = {
        type: step.type,
        name: typeof step.name === 'string' ? step.name : step.id,
      };

      if (step.type === 'tool') {
        stepOut.tool = step.tool ?? null;
        stepOut.arguments = step.arguments ?? null;
      } else if (step.type === 'agent') {
        stepOut.goal = step.goal ?? null;
        stepOut.context = step.context ?? null;
      }

      const completedAt = nowIso();
      result.status = 'completed';
      result.completedAt = completedAt;
      result.output = stepOut;

      const outputVar = stepOutputVariable(step);
      if (outputVar) {
        ctx.outputs[outputVar] = stepOut;
      }

      emit(sink, { type: 'step.completed', executionId: ctx.executionId, stepId: step.id, attempt: ctx.attempt, ts: completedAt });
    } catch (error) {
      const completedAt = nowIso();
      const message = error instanceof Error ? error.message : String(error);
      result.status = 'failed';
      result.error = message;
      result.completedAt = completedAt;

      emit(sink, {
        type: 'step.failed',
        executionId: ctx.executionId,
        stepId: step.id,
        attempt: ctx.attempt,
        error: message,
        ts: completedAt,
      });

      return { failed: message };
    }
  }

  return {};
}

export async function executeWorkflowRun(
  executionId: string,
  workflow: NormalizedWorkflowDefinition,
  payload: WorkflowRunPayload,
  sink?: EventSink,
): Promise<WorkflowRunEnvelope> {
  const startedAt = nowIso();
  const attempt = payload.runtime?.attempt && payload.runtime.attempt > 0 ? payload.runtime.attempt : 1;
  const maxSteps = payload.runtime?.policy?.maxSteps && payload.runtime.policy.maxSteps > 0
    ? payload.runtime.policy.maxSteps
    : 50;

  emit(sink, { type: 'execution.started', executionId, ts: startedAt });

  const context: ExecutionContext = {
    executionId,
    attempt,
    variables: { ...(payload.variables || {}) },
    outputs: {},
    steps: [],
    maxSteps,
    visitedSteps: 0,
  };

  const run = await executeSteps(workflow.steps || [], context, sink);

  if (run.approval) {
    const finishedAt = nowIso();
    emit(sink, { type: 'execution.finished', executionId, status: 'needs_approval', ts: finishedAt });
    return {
      ok: true,
      status: 'needs_approval',
      executionId,
      output: context.outputs,
      steps: context.steps,
      requiresApproval: run.approval,
      error: null,
    };
  }

  if (run.failed) {
    const finishedAt = nowIso();
    emit(sink, { type: 'execution.finished', executionId, status: 'failed', ts: finishedAt });
    return {
      ok: false,
      status: 'failed',
      executionId,
      output: context.outputs,
      steps: context.steps,
      requiresApproval: null,
      error: run.failed,
    };
  }

  const finishedAt = nowIso();
  emit(sink, { type: 'execution.finished', executionId, status: 'ok', ts: finishedAt });
  return {
    ok: true,
    status: 'ok',
    executionId,
    output: context.outputs,
    steps: context.steps,
    requiresApproval: null,
    error: null,
  };
}
