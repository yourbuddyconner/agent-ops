-- Add denormalized metrics columns to sessions for dashboard queries.
-- These are periodically flushed from each SessionAgent DO's local SQLite.
ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0;
