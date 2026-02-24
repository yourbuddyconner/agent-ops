import type { D1Database } from '@cloudflare/workers-types';

// ─── Data Access ─────────────────────────────────────────────────────────────

export async function lookupWebhookTrigger(db: D1Database, webhookPath: string) {
  return db.prepare(`
    SELECT t.*, w.id as workflow_id, w.name as workflow_name, w.user_id, w.version, w.data
    FROM triggers t
    JOIN workflows w ON t.workflow_id = w.id
    WHERE t.type = 'webhook'
      AND t.enabled = 1
      AND json_extract(t.config, '$.path') = ?
  `).bind(webhookPath).first<{
    id: string;
    workflow_id: string;
    workflow_name: string;
    user_id: string;
    version: string | null;
    data: string;
    config: string;
    variable_mapping: string | null;
  }>();
}

export async function findSessionsByPR(
  db: D1Database,
  repoFullName: string,
  prNumber: number
) {
  return db.prepare(
    `SELECT session_id FROM session_git_state
     WHERE source_repo_full_name = ?
       AND (pr_number = ? OR source_pr_number = ?)`
  ).bind(repoFullName, prNumber, prNumber).all<{ session_id: string }>();
}

export async function findSessionsByRepoBranch(
  db: D1Database,
  repoFullName: string,
  branch: string
) {
  return db.prepare(
    `SELECT session_id, commit_count FROM session_git_state
     WHERE source_repo_full_name = ? AND branch = ?`
  ).bind(repoFullName, branch).all<{ session_id: string; commit_count: number }>();
}
