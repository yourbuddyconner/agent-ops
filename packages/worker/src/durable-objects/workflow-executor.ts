import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from '../env.js';

interface EnqueueRequest {
  executionId: string;
  workflowId: string;
  userId: string;
  sessionId?: string;
  triggerType: 'manual' | 'webhook' | 'schedule';
}

interface ResumeRequest {
  executionId: string;
  resumeToken: string;
  approve: boolean;
  reason?: string;
}

interface CancelRequest {
  executionId: string;
  reason?: string;
}

interface RuntimeState {
  executor?: {
    dispatchCount: number;
    firstEnqueuedAt: string;
    lastEnqueuedAt: string;
    sessionId?: string;
    triggerType: 'manual' | 'webhook' | 'schedule';
  };
}

export class WorkflowExecutorDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/enqueue' && request.method === 'POST') {
      return this.handleEnqueue(request);
    }

    if (url.pathname === '/status' && request.method === 'GET') {
      return Response.json({ ok: true, state: 'ready' });
    }

    if (url.pathname === '/resume' && request.method === 'POST') {
      return this.handleResume(request);
    }

    if (url.pathname === '/cancel' && request.method === 'POST') {
      return this.handleCancel(request);
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleEnqueue(request: Request): Promise<Response> {
    const body = await request.json<EnqueueRequest>();
    if (!body.executionId || !body.workflowId || !body.userId || !body.triggerType) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const row = await this.env.DB.prepare(`
      SELECT id, status, runtime_state
      FROM workflow_executions
      WHERE id = ?
      LIMIT 1
    `).bind(body.executionId).first<{ id: string; status: string; runtime_state: string | null }>();

    if (!row) {
      return Response.json({ error: 'Execution not found' }, { status: 404 });
    }

    if (row.status === 'completed' || row.status === 'failed') {
      return Response.json({ ok: true, ignored: true, reason: 'already_finalized' });
    }

    const existingState = this.parseRuntimeState(row.runtime_state);
    const now = new Date().toISOString();
    const dispatchCount = (existingState.executor?.dispatchCount ?? 0) + 1;

    const nextState: RuntimeState = {
      ...existingState,
      executor: {
        dispatchCount,
        firstEnqueuedAt: existingState.executor?.firstEnqueuedAt || now,
        lastEnqueuedAt: now,
        sessionId: body.sessionId,
        triggerType: body.triggerType,
      },
    };

    await this.env.DB.prepare(`
      UPDATE workflow_executions
      SET runtime_state = ?
      WHERE id = ?
    `).bind(JSON.stringify(nextState), body.executionId).run();

    await this.publishEnqueuedEvent(body.executionId, body.userId, body.workflowId, body.triggerType, dispatchCount);

    return Response.json({ ok: true, executionId: body.executionId, dispatchCount });
  }

  private async handleResume(request: Request): Promise<Response> {
    const body = await request.json<ResumeRequest>();
    if (!body.executionId || !body.resumeToken) {
      return Response.json({ error: 'Missing executionId or resumeToken' }, { status: 400 });
    }

    const row = await this.env.DB.prepare(`
      SELECT id, status, resume_token, runtime_state, user_id, workflow_id
      FROM workflow_executions
      WHERE id = ?
      LIMIT 1
    `).bind(body.executionId).first<{
      id: string;
      status: string;
      resume_token: string | null;
      runtime_state: string | null;
      user_id: string;
      workflow_id: string;
    }>();

    if (!row) {
      return Response.json({ error: 'Execution not found' }, { status: 404 });
    }

    if (row.status !== 'waiting_approval') {
      return Response.json({ error: 'Execution is not waiting approval' }, { status: 409 });
    }

    if (row.resume_token && row.resume_token !== body.resumeToken) {
      return Response.json({ error: 'Invalid resume token' }, { status: 400 });
    }

    const existingState = this.parseRuntimeState(row.runtime_state);
    const now = new Date().toISOString();
    const nextState: RuntimeState = {
      ...existingState,
      executor: {
        dispatchCount: existingState.executor?.dispatchCount ?? 0,
        firstEnqueuedAt: existingState.executor?.firstEnqueuedAt || now,
        lastEnqueuedAt: existingState.executor?.lastEnqueuedAt || now,
        sessionId: existingState.executor?.sessionId,
        triggerType: existingState.executor?.triggerType || 'manual',
      },
    };

    if (body.approve) {
      await this.env.DB.prepare(`
        UPDATE workflow_executions
        SET status = 'running',
            resume_token = NULL,
            runtime_state = ?,
            error = NULL
        WHERE id = ?
      `).bind(JSON.stringify(nextState), body.executionId).run();

      await this.publishLifecycleEvent(row.user_id, row.workflow_id, body.executionId, 'resumed', null);
      return Response.json({ ok: true, executionId: body.executionId, status: 'running' });
    }

    const reason = body.reason || 'approval_denied';
    await this.env.DB.prepare(`
      UPDATE workflow_executions
      SET status = 'failed',
          resume_token = NULL,
          runtime_state = ?,
          error = ?,
          completed_at = ?
      WHERE id = ?
    `).bind(JSON.stringify(nextState), reason, now, body.executionId).run();

    await this.publishLifecycleEvent(row.user_id, row.workflow_id, body.executionId, 'denied', reason);
    return Response.json({ ok: true, executionId: body.executionId, status: 'failed' });
  }

  private async handleCancel(request: Request): Promise<Response> {
    const body = await request.json<CancelRequest>();
    if (!body.executionId) {
      return Response.json({ error: 'Missing executionId' }, { status: 400 });
    }

    const row = await this.env.DB.prepare(`
      SELECT id, status, runtime_state, user_id, workflow_id
      FROM workflow_executions
      WHERE id = ?
      LIMIT 1
    `).bind(body.executionId).first<{
      id: string;
      status: string;
      runtime_state: string | null;
      user_id: string;
      workflow_id: string;
    }>();

    if (!row) {
      return Response.json({ error: 'Execution not found' }, { status: 404 });
    }

    if (row.status === 'completed' || row.status === 'failed') {
      return Response.json({ ok: true, ignored: true, reason: 'already_finalized', status: row.status });
    }

    const existingState = this.parseRuntimeState(row.runtime_state);
    const now = new Date().toISOString();
    const reason = body.reason || 'cancelled_by_user';

    await this.env.DB.prepare(`
      UPDATE workflow_executions
      SET status = 'failed',
          runtime_state = ?,
          error = ?,
          completed_at = ?
      WHERE id = ?
    `).bind(JSON.stringify(existingState), reason, now, body.executionId).run();

    await this.publishLifecycleEvent(row.user_id, row.workflow_id, body.executionId, 'cancelled', reason);
    return Response.json({ ok: true, executionId: body.executionId, status: 'failed' });
  }

  private parseRuntimeState(raw: string | null): RuntimeState {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as RuntimeState;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async publishEnqueuedEvent(
    executionId: string,
    userId: string,
    workflowId: string,
    triggerType: 'manual' | 'webhook' | 'schedule',
    dispatchCount: number
  ): Promise<void> {
    try {
      const eventBusId = this.env.EVENT_BUS.idFromName('global');
      const eventBus = this.env.EVENT_BUS.get(eventBusId);
      await eventBus.fetch(new Request('https://event-bus/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          event: {
            type: 'notification',
            data: {
              category: 'workflow.execution.enqueued',
              executionId,
              workflowId,
              triggerType,
              dispatchCount,
            },
            timestamp: new Date().toISOString(),
          },
        }),
      }));
    } catch (error) {
      console.error('Failed to publish workflow enqueue event', error);
    }
  }

  private async publishLifecycleEvent(
    userId: string,
    workflowId: string,
    executionId: string,
    action: 'resumed' | 'denied' | 'cancelled',
    reason: string | null
  ): Promise<void> {
    try {
      const eventBusId = this.env.EVENT_BUS.idFromName('global');
      const eventBus = this.env.EVENT_BUS.get(eventBusId);
      await eventBus.fetch(new Request('https://event-bus/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          event: {
            type: 'notification',
            data: {
              category: `workflow.execution.${action}`,
              executionId,
              workflowId,
              ...(reason ? { reason } : {}),
            },
            timestamp: new Date().toISOString(),
          },
        }),
      }));
    } catch (error) {
      console.error('Failed to publish workflow lifecycle event', error);
    }
  }
}
