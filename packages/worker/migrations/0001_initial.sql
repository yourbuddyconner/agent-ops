-- Consolidated schema for Agent-Ops

-- Users
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  github_id TEXT,
  github_username TEXT,
  git_name TEXT,
  git_email TEXT,
  onboarding_completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_users_github_id ON users(github_id);

-- API tokens for programmatic access
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  prefix TEXT,
  scopes TEXT DEFAULT '[]',
  last_used_at TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);
CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
CREATE INDEX idx_api_tokens_prefix ON api_tokens(prefix);

-- Auth sessions (OAuth login sessions)
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  provider TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX idx_auth_sessions_token ON auth_sessions(token_hash);

-- OAuth tokens (encrypted provider tokens)
CREATE TABLE oauth_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  scopes TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, provider)
);

-- Agent sessions
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initializing',
  container_id TEXT,
  sandbox_id TEXT,
  tunnel_urls TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_active_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Message history
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  parts TEXT,
  tool_calls TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_session ON messages(session_id);

-- Screenshots
CREATE TABLE screenshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL,
  description TEXT,
  taken_at TEXT DEFAULT (datetime('now')),
  metadata TEXT
);
CREATE INDEX idx_screenshots_session ON screenshots(session_id);

-- Agent memories
CREATE TABLE agent_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  session_id TEXT,
  workspace TEXT,
  content TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_memories_user ON agent_memories(user_id);
CREATE INDEX idx_memories_workspace ON agent_memories(user_id, workspace);

-- Third-party integrations
CREATE TABLE integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service TEXT NOT NULL,
  config TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  last_synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, service)
);
CREATE INDEX idx_integrations_user ON integrations(user_id);
CREATE INDEX idx_integrations_service ON integrations(service);

-- Sync job logs
CREATE TABLE sync_logs (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  records_synced INTEGER DEFAULT 0,
  errors TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX idx_sync_logs_integration ON sync_logs(integration_id);

-- Synced entities
CREATE TABLE synced_entities (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  external_id TEXT NOT NULL,
  data TEXT NOT NULL,
  synced_at TEXT DEFAULT (datetime('now')),
  UNIQUE(integration_id, entity_type, external_id)
);
CREATE INDEX idx_synced_entities_integration ON synced_entities(integration_id);
CREATE INDEX idx_synced_entities_type ON synced_entities(integration_id, entity_type);

-- Workflows
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT,
  name TEXT NOT NULL,
  description TEXT,
  version TEXT NOT NULL DEFAULT '1.0.0',
  data TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  tags TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);
CREATE INDEX idx_workflows_user ON workflows(user_id);
CREATE INDEX idx_workflows_slug ON workflows(user_id, slug);
CREATE INDEX idx_workflows_enabled ON workflows(enabled);

-- Triggers
CREATE TABLE triggers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  type TEXT NOT NULL CHECK (type IN ('webhook', 'schedule', 'manual')),
  config TEXT NOT NULL,
  variable_mapping TEXT,
  last_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_triggers_user ON triggers(user_id);
CREATE INDEX idx_triggers_workflow ON triggers(workflow_id);
CREATE INDEX idx_triggers_type ON triggers(type);
CREATE INDEX idx_triggers_enabled ON triggers(enabled);

-- Workflow executions
CREATE TABLE workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_id TEXT REFERENCES triggers(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'waiting_approval')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual', 'webhook', 'schedule')),
  trigger_metadata TEXT,
  variables TEXT,
  outputs TEXT,
  steps TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_workflow_executions_user ON workflow_executions(user_id);
CREATE INDEX idx_workflow_executions_trigger ON workflow_executions(trigger_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_workflow_executions_started ON workflow_executions(started_at DESC);

-- Pending approvals
CREATE TABLE pending_approvals (
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
CREATE INDEX idx_pending_approvals_execution ON pending_approvals(execution_id);
CREATE INDEX idx_pending_approvals_status ON pending_approvals(status);
