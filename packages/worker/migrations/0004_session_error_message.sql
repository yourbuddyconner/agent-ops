-- Add error_message column to sessions for storing error details
ALTER TABLE sessions ADD COLUMN error_message TEXT;
