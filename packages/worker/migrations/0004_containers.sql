-- Containers table (tracks per-user OpenCode container instances)
CREATE TABLE IF NOT EXISTS containers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'stopped' CHECK (status IN ('stopped', 'starting', 'running', 'stopping', 'error')),
  instance_size TEXT NOT NULL DEFAULT 'basic' CHECK (instance_size IN ('dev', 'basic', 'standard')),
  region TEXT,                         -- Cloudflare region where container is running
  container_id TEXT,                   -- CF Container ID when running
  ip_address TEXT,                     -- Internal IP for routing
  port INTEGER DEFAULT 4096,
  workspace_path TEXT,                 -- Path to user's workspace volume
  auto_sleep_minutes INTEGER DEFAULT 15,
  last_active_at TEXT,
  started_at TEXT,
  stopped_at TEXT,
  error_message TEXT,
  metadata TEXT,                       -- JSON for additional config
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);

-- Indexes for containers
CREATE INDEX IF NOT EXISTS idx_containers_user ON containers(user_id);
CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
CREATE INDEX IF NOT EXISTS idx_containers_last_active ON containers(last_active_at);
