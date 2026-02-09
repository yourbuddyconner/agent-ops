-- Add per-user active session limit (NULL = use system default of 10)
ALTER TABLE users ADD COLUMN max_active_sessions INTEGER DEFAULT NULL;
