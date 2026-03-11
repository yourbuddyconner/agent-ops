-- Multi-orchestrator thread support:
-- 1. Widen unique index to include user_id (allows multiple users per external thread)
-- 2. Add last_seen_ts cursor column for tracking thread context

-- Drop the old unique index (one mapping per external thread)
DROP INDEX IF EXISTS idx_channel_thread_mappings_lookup;

-- Create new unique index scoped to user (one mapping per user per external thread)
CREATE UNIQUE INDEX idx_channel_thread_mappings_user_lookup
  ON channel_thread_mappings(channel_type, channel_id, external_thread_id, user_id);

-- Add cursor column for tracking last seen message timestamp
ALTER TABLE channel_thread_mappings ADD COLUMN last_seen_ts TEXT;

-- Drop slack_bot_threads (no longer used for routing)
DROP TABLE IF EXISTS slack_bot_threads;
