-- Add user preference for how UI prompts are dispatched while a session is busy.
-- Valid values: 'followup' | 'collect' | 'steer'
ALTER TABLE users ADD COLUMN ui_queue_mode TEXT DEFAULT 'followup';
