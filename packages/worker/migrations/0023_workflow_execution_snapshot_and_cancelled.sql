-- Expand workflow_executions status enum and persist immutable workflow snapshots.

PRAGMA foreign_keys = OFF;

CREATE TABLE workflow_executions_new (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'skipped')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'webhook', 'schedule')),
  trigger_metadata TEXT,
  variables TEXT,
  outputs TEXT,
  steps TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  workflow_version TEXT,
  workflow_hash TEXT,
  workflow_snapshot TEXT,
  idempotency_key TEXT,
  runtime_state TEXT,
  resume_token TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  initiator_type TEXT,
  initiator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO workflow_executions_new (
  id,
  workflow_id,
  user_id,
  trigger_id,
  status,
  trigger_type,
  trigger_metadata,
  variables,
  outputs,
  steps,
  error,
  started_at,
  completed_at,
  workflow_version,
  workflow_hash,
  workflow_snapshot,
  idempotency_key,
  runtime_state,
  resume_token,
  attempt_count,
  session_id,
  initiator_type,
  initiator_user_id
)
SELECT
  e.id,
  e.workflow_id,
  e.user_id,
  e.trigger_id,
  e.status,
  e.trigger_type,
  e.trigger_metadata,
  e.variables,
  e.outputs,
  e.steps,
  e.error,
  e.started_at,
  e.completed_at,
  e.workflow_version,
  e.workflow_hash,
  (SELECT w.data FROM workflows w WHERE w.id = e.workflow_id),
  e.idempotency_key,
  e.runtime_state,
  e.resume_token,
  COALESCE(e.attempt_count, 0),
  e.session_id,
  e.initiator_type,
  e.initiator_user_id
FROM workflow_executions e;

DROP TABLE workflow_executions;
ALTER TABLE workflow_executions_new RENAME TO workflow_executions;

CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_user ON workflow_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_trigger ON workflow_executions(trigger_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_started ON workflow_executions(started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_executions_idempotency ON workflow_executions(workflow_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_session ON workflow_executions(session_id);

PRAGMA foreign_keys = ON;
