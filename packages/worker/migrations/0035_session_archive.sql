-- Session archival: add partial index for efficient archive queries.
-- The 'archived' status value needs no schema change (SQLite TEXT columns accept any value).
CREATE INDEX IF NOT EXISTS idx_sessions_archived
  ON sessions(status, last_active_at DESC)
  WHERE status = 'archived';
