import type { D1Database } from '@cloudflare/workers-types';
import * as db from './db.js';

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
