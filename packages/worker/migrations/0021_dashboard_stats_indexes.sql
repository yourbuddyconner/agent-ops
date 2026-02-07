-- Indexes to speed up dashboard stats queries
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user_created_at ON sessions(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace_created_at ON sessions(workspace, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status_last_active_at ON sessions(status, last_active_at);
