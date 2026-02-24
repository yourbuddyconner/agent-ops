import type { D1Database } from '@cloudflare/workers-types';
import type { SessionTask } from '@agent-ops/shared';
import { mapSessionTask } from './mappers.js';

export async function createSessionTask(
  db: D1Database,
  data: {
    orchestratorSessionId: string;
    sessionId?: string;
    title: string;
    description?: string;
    status?: string;
    parentTaskId?: string;
    blockedBy?: string[];
  },
): Promise<SessionTask> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const status = data.blockedBy?.length ? 'blocked' : (data.status || 'pending');

  await db
    .prepare(
      `INSERT INTO session_tasks (id, orchestrator_session_id, session_id, title, description, status, parent_task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, data.orchestratorSessionId, data.sessionId || null, data.title, data.description || null, status, data.parentTaskId || null, now, now)
    .run();

  if (data.blockedBy?.length) {
    for (const blockedById of data.blockedBy) {
      await db
        .prepare('INSERT INTO session_task_dependencies (task_id, blocked_by_task_id) VALUES (?, ?)')
        .bind(id, blockedById)
        .run();
    }
  }

  return {
    id,
    orchestratorSessionId: data.orchestratorSessionId,
    sessionId: data.sessionId,
    title: data.title,
    description: data.description,
    status: status as SessionTask['status'],
    parentTaskId: data.parentTaskId,
    blockedBy: data.blockedBy,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getSessionTasks(
  db: D1Database,
  orchestratorSessionId: string,
  opts?: { status?: string; limit?: number },
): Promise<SessionTask[]> {
  const conditions = ['t.orchestrator_session_id = ?'];
  const params: (string | number)[] = [orchestratorSessionId];

  if (opts?.status) {
    conditions.push('t.status = ?');
    params.push(opts.status);
  }

  const limit = opts?.limit ?? 100;
  params.push(limit);

  const result = await db
    .prepare(
      `SELECT t.*,
              s.title AS session_title,
              GROUP_CONCAT(d.blocked_by_task_id) AS blocked_by_ids
       FROM session_tasks t
       LEFT JOIN sessions s ON t.session_id = s.id
       LEFT JOIN session_task_dependencies d ON t.id = d.task_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all();

  return (result.results || []).map(mapSessionTask);
}

export async function getMyTasks(
  db: D1Database,
  sessionId: string,
  opts?: { status?: string; limit?: number },
): Promise<SessionTask[]> {
  const conditions = ['t.session_id = ?'];
  const params: (string | number)[] = [sessionId];

  if (opts?.status) {
    conditions.push('t.status = ?');
    params.push(opts.status);
  }

  const limit = opts?.limit ?? 100;
  params.push(limit);

  const result = await db
    .prepare(
      `SELECT t.*,
              GROUP_CONCAT(d.blocked_by_task_id) AS blocked_by_ids
       FROM session_tasks t
       LEFT JOIN session_task_dependencies d ON t.id = d.task_id
       WHERE ${conditions.join(' AND ')}
       GROUP BY t.id
       ORDER BY t.created_at DESC
       LIMIT ?`,
    )
    .bind(...params)
    .all();

  return (result.results || []).map(mapSessionTask);
}

export async function updateSessionTask(
  db: D1Database,
  taskId: string,
  updates: { status?: string; result?: string; description?: string; sessionId?: string; title?: string },
): Promise<SessionTask | null> {
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const params: (string | null)[] = [];

  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    params.push(updates.status);
  }
  if (updates.result !== undefined) {
    setClauses.push('result = ?');
    params.push(updates.result);
  }
  if (updates.description !== undefined) {
    setClauses.push('description = ?');
    params.push(updates.description);
  }
  if (updates.sessionId !== undefined) {
    setClauses.push('session_id = ?');
    params.push(updates.sessionId);
  }
  if (updates.title !== undefined) {
    setClauses.push('title = ?');
    params.push(updates.title);
  }

  params.push(taskId);

  await db
    .prepare(`UPDATE session_tasks SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  const row = await db
    .prepare(
      `SELECT t.*, GROUP_CONCAT(d.blocked_by_task_id) AS blocked_by_ids
       FROM session_tasks t
       LEFT JOIN session_task_dependencies d ON t.id = d.task_id
       WHERE t.id = ?
       GROUP BY t.id`,
    )
    .bind(taskId)
    .first();

  return row ? mapSessionTask(row) : null;
}

export async function addTaskDependency(db: D1Database, taskId: string, blockedByTaskId: string): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO session_task_dependencies (task_id, blocked_by_task_id) VALUES (?, ?)')
    .bind(taskId, blockedByTaskId)
    .run();
  // Auto-set status to blocked
  await db
    .prepare("UPDATE session_tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .bind(taskId)
    .run();
}

export async function getTaskDependencies(db: D1Database, taskId: string): Promise<string[]> {
  const result = await db
    .prepare('SELECT blocked_by_task_id FROM session_task_dependencies WHERE task_id = ?')
    .bind(taskId)
    .all<{ blocked_by_task_id: string }>();
  return (result.results || []).map((r) => r.blocked_by_task_id);
}
