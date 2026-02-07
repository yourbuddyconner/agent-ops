-- Workflow runtime foundations

-- Session purpose: interactive | orchestrator | workflow
ALTER TABLE sessions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'interactive' CHECK (purpose IN ('interactive', 'orchestrator', 'workflow'));
UPDATE sessions SET purpose = 'orchestrator' WHERE is_orchestrator = 1;
CREATE INDEX IF NOT EXISTS idx_sessions_purpose_user_status ON sessions(purpose, user_id, status);

-- Extend workflow executions with deterministic runtime fields
ALTER TABLE workflow_executions ADD COLUMN workflow_version TEXT;
ALTER TABLE workflow_executions ADD COLUMN workflow_hash TEXT;
ALTER TABLE workflow_executions ADD COLUMN idempotency_key TEXT;
ALTER TABLE workflow_executions ADD COLUMN runtime_state TEXT;
ALTER TABLE workflow_executions ADD COLUMN resume_token TEXT;
ALTER TABLE workflow_executions ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workflow_executions ADD COLUMN session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE workflow_executions ADD COLUMN initiator_type TEXT;
ALTER TABLE workflow_executions ADD COLUMN initiator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_executions_idempotency
  ON workflow_executions(workflow_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_session
  ON workflow_executions(session_id);

-- Step-level execution trace
CREATE TABLE IF NOT EXISTS workflow_execution_steps (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled', 'skipped')),
  input_json TEXT,
  output_json TEXT,
  error TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(execution_id, step_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_execution
  ON workflow_execution_steps(execution_id);
CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_status
  ON workflow_execution_steps(status);

-- Self-modification proposals
CREATE TABLE IF NOT EXISTS workflow_mutation_proposals (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  execution_id TEXT REFERENCES workflow_executions(id) ON DELETE SET NULL,
  proposed_by_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  base_workflow_hash TEXT NOT NULL,
  proposal_json TEXT NOT NULL,
  diff_text TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  review_notes TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_workflow_mutation_proposals_workflow
  ON workflow_mutation_proposals(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_mutation_proposals_status
  ON workflow_mutation_proposals(status);

-- Schedule tick deduplication
CREATE TABLE IF NOT EXISTS workflow_schedule_ticks (
  id TEXT PRIMARY KEY,
  trigger_id TEXT NOT NULL REFERENCES triggers(id) ON DELETE CASCADE,
  tick_bucket TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(trigger_id, tick_bucket)
);
CREATE INDEX IF NOT EXISTS idx_workflow_schedule_ticks_trigger
  ON workflow_schedule_ticks(trigger_id);
