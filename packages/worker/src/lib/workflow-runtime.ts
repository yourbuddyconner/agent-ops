import type { D1Database } from '@cloudflare/workers-types';
import * as db from './db.js';
import type { Env } from '../env.js';

function buildWorkflowWorkspace(workflowId: string, executionId: string): string {
  const wf = workflowId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'workflow';
  const ex = executionId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 16) || 'execution';
  return `workflow-${wf}-${ex}`.slice(0, 100);
}

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
  try {
    const doId = env.WORKFLOW_EXECUTOR.idFromName(params.executionId);
    const stub = env.WORKFLOW_EXECUTOR.get(doId);
    const response = await stub.fetch(new Request('https://workflow-executor/enqueue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }));
    return response.ok;
  } catch (error) {
    console.error('Failed to enqueue workflow execution', error);
    return false;
  }
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
