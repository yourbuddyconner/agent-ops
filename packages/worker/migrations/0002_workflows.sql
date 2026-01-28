-- Workflows table (stores workflow definitions synced from plugin)
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  data TEXT NOT NULL,              -- Full workflow YAML converted to JSON
  enabled INTEGER DEFAULT 1,
  tags TEXT,                       -- JSON array of tags
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);

-- Triggers table (worker-side trigger configuration)
CREATE TABLE IF NOT EXISTS triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  type TEXT NOT NULL CHECK (type IN ('webhook', 'schedule', 'manual')),
  config TEXT NOT NULL,            -- Type-specific config as JSON
  variable_mapping TEXT,           -- JSONPath mappings as JSON
  last_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workflow executions (audit log of all runs)
CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'waiting_approval')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'webhook', 'schedule')),
  trigger_metadata TEXT,           -- Details about what triggered this run
  variables TEXT,                  -- Input variables (JSON)
  outputs TEXT,                    -- Output variables from steps (JSON)
  steps TEXT,                      -- Step execution details (JSON)
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

-- Pending approvals table for approval step persistence
CREATE TABLE IF NOT EXISTS pending_approvals (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  message TEXT NOT NULL,
  timeout_at TEXT,
  default_action TEXT CHECK (default_action IN ('approve', 'reject')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  responded_at TEXT,
  responded_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for workflow tables
CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);
CREATE INDEX IF NOT EXISTS idx_workflows_slug ON workflows(user_id, slug);
CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);
CREATE INDEX IF NOT EXISTS idx_triggers_user ON triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_triggers_workflow ON triggers(workflow_id);
CREATE INDEX IF NOT EXISTS idx_triggers_type ON triggers(type);
CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers(enabled);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_user ON workflow_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_trigger ON workflow_executions(trigger_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_started ON workflow_executions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_execution ON pending_approvals(execution_id);
CREATE INDEX IF NOT EXISTS idx_pending_approvals_status ON pending_approvals(status);
