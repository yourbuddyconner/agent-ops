-- Immutable workflow definition history for rollback/version tracking.

CREATE TABLE IF NOT EXISTS workflow_version_history (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  workflow_version TEXT,
  workflow_hash TEXT NOT NULL,
  workflow_data TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('sync', 'update', 'proposal_apply', 'rollback', 'system')),
  source_proposal_id TEXT REFERENCES workflow_mutation_proposals(id) ON DELETE SET NULL,
  notes TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(workflow_id, workflow_hash)
);

CREATE INDEX IF NOT EXISTS idx_workflow_version_history_workflow_created
  ON workflow_version_history(workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_version_history_hash
  ON workflow_version_history(workflow_hash);
