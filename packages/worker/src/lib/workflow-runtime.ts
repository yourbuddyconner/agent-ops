import type { D1Database } from '@cloudflare/workers-types';
import * as db from './db.js';
import type { Env } from '../env.js';

const ENQUEUE_MAX_ATTEMPTS = 5;
const ENQUEUE_BASE_DELAY_MS = 150;

function buildWorkflowWorkspace(workflowId: string, executionId: string): string {
  const wf = workflowId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'workflow';
  const ex = executionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'execution';
  return `workflow-${wf}-${ex}`.slice(0, 100);
}

function shouldRetryEnqueueStatus(status: number): boolean {
  return (
    status === 404 || // D1 read-after-write race across colo
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type EnqueueResponseBody = {
  ok?: boolean;
  promptDispatched?: boolean;
  status?: string;
  ignored?: boolean;
  reason?: string;
  error?: string;
};

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createWorkflowSession(
  database: D1Database,
  params: {
    userId: string;
    workflowId: string;
    executionId: string;
    sourceRepoFullName?: string;
    sourceRepoUrl?: string;
    branch?: string;
    ref?: string;
  }
): Promise<string> {
  const sessionId = crypto.randomUUID();

  await db.createSession(database, {
    id: sessionId,
    userId: params.userId,
    workspace: buildWorkflowWorkspace(params.workflowId, params.executionId),
    title: `Workflow ${params.workflowId.slice(0, 12)} run`,
    metadata: {
      workflowId: params.workflowId,
      executionId: params.executionId,
      internal: true,
    },
    purpose: 'workflow',
  });

  await db.createSessionGitState(database, {
    sessionId,
    sourceType: 'manual',
    sourceRepoFullName: params.sourceRepoFullName,
    sourceRepoUrl: params.sourceRepoUrl,
    branch: params.branch,
    ref: params.ref,
  });

  // Workflow sessions are created headless and should not appear as active runtime sessions.
  await db.updateSessionStatus(database, sessionId, 'hibernated');

  return sessionId;
}

export async function enqueueWorkflowExecution(
  env: Env,
  params: {
    executionId: string;
    workflowId: string;
    userId: string;
    sessionId?: string;
    triggerType: 'manual' | 'webhook' | 'schedule';
    workerOrigin?: string;
  }
): Promise<boolean> {
  const doId = env.WORKFLOW_EXECUTOR.idFromName(params.executionId);
  const stub = env.WORKFLOW_EXECUTOR.get(doId);

  for (let attempt = 1; attempt <= ENQUEUE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await stub.fetch(new Request('https://workflow-executor/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }));

      if (response.ok) {
        let body: EnqueueResponseBody | null = null;
        try {
          body = await response.clone().json<EnqueueResponseBody>();
        } catch {
          body = null;
        }

        // Defensive: explicit non-dispatch should not be treated as success for fresh runs.
        if (body?.promptDispatched === false && !body.ignored) {
          const shouldRetry = attempt < ENQUEUE_MAX_ATTEMPTS;
          if (!shouldRetry) {
            console.error(
              `[WorkflowRuntime] Enqueue returned promptDispatched=false for ${params.executionId} ` +
              `after ${attempt} attempt(s): ${body.error || '<no error>'}`
            );
            return false;
          }
          const waitMs = ENQUEUE_BASE_DELAY_MS * attempt;
          console.warn(
            `[WorkflowRuntime] Enqueue response not dispatched for ${params.executionId} ` +
            `(attempt ${attempt}/${ENQUEUE_MAX_ATTEMPTS}, status=${body.status || 'unknown'}). ` +
            `Retrying in ${waitMs}ms`
          );
          await delay(waitMs);
          continue;
        }

        return true;
      }

      const errText = (await response.text().catch(() => '')).slice(0, 500);
      const shouldRetry = attempt < ENQUEUE_MAX_ATTEMPTS && shouldRetryEnqueueStatus(response.status);
      if (!shouldRetry) {
        console.error(
          `[WorkflowRuntime] Failed to enqueue execution ${params.executionId} ` +
          `after ${attempt} attempt(s): status=${response.status} body=${errText || '<empty>'}`
        );
        return false;
      }

      const waitMs = ENQUEUE_BASE_DELAY_MS * attempt;
      console.warn(
        `[WorkflowRuntime] Enqueue attempt ${attempt}/${ENQUEUE_MAX_ATTEMPTS} failed for ${params.executionId} ` +
        `(status=${response.status}). Retrying in ${waitMs}ms`
      );
      await delay(waitMs);
    } catch (error) {
      if (attempt >= ENQUEUE_MAX_ATTEMPTS) {
        console.error(`[WorkflowRuntime] Failed to enqueue execution ${params.executionId}`, error);
        return false;
      }
      const waitMs = ENQUEUE_BASE_DELAY_MS * attempt;
      console.warn(
        `[WorkflowRuntime] Enqueue attempt ${attempt}/${ENQUEUE_MAX_ATTEMPTS} errored for ${params.executionId}. ` +
        `Retrying in ${waitMs}ms`,
        error
      );
      await delay(waitMs);
    }
  }

  return false;
}

export async function checkWorkflowConcurrency(
  database: D1Database,
  userId: string,
  limits: { perUser?: number; global?: number } = {},
): Promise<{ allowed: boolean; reason?: string; activeUser: number; activeGlobal: number }> {
  const perUserLimit = limits.perUser ?? 5;
  const globalLimit = limits.global ?? 50;

  const userRow = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM workflow_executions
    WHERE user_id = ?
      AND status IN ('pending', 'running', 'waiting_approval')
  `).bind(userId).first<{ count: number }>();

  const globalRow = await database.prepare(`
    SELECT COUNT(*) AS count
    FROM workflow_executions
    WHERE status IN ('pending', 'running', 'waiting_approval')
  `).first<{ count: number }>();

  const activeUser = userRow?.count ?? 0;
  const activeGlobal = globalRow?.count ?? 0;

  if (activeUser >= perUserLimit) {
    return {
      allowed: false,
      reason: `per_user_limit_exceeded:${perUserLimit}`,
      activeUser,
      activeGlobal,
    };
  }

  if (activeGlobal >= globalLimit) {
    return {
      allowed: false,
      reason: `global_limit_exceeded:${globalLimit}`,
      activeUser,
      activeGlobal,
    };
  }

  return { allowed: true, activeUser, activeGlobal };
}
