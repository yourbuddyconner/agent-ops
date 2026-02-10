-- Per-channel OpenCode sessions and full message archival
-- Add opencode_session_id to messages for per-channel session tracking
ALTER TABLE messages ADD COLUMN opencode_session_id TEXT;
