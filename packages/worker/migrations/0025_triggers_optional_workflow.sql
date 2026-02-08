-- Allow triggers without a linked workflow (for orchestrator-target schedules).

PRAGMA foreign_keys = OFF;

CREATE TABLE triggers_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  type TEXT NOT NULL CHECK (type IN ('webhook', 'schedule', 'manual')),
  config TEXT NOT NULL,
  variable_mapping TEXT,
  last_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT INTO triggers_new (
  id,
  user_id,
  workflow_id,
  name,
  enabled,
  type,
  config,
  variable_mapping,
  last_run_at,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  workflow_id,
  name,
  enabled,
  type,
  config,
  variable_mapping,
  last_run_at,
  created_at,
  updated_at
FROM triggers;

DROP TABLE triggers;
ALTER TABLE triggers_new RENAME TO triggers;

CREATE INDEX IF NOT EXISTS idx_triggers_user ON triggers(user_id);
CREATE INDEX IF NOT EXISTS idx_triggers_workflow ON triggers(workflow_id);
CREATE INDEX IF NOT EXISTS idx_triggers_type ON triggers(type);
CREATE INDEX IF NOT EXISTS idx_triggers_enabled ON triggers(enabled);

PRAGMA foreign_keys = ON;
