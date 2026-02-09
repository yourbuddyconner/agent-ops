-- Add channel metadata columns to messages table
-- Tracks which external channel (telegram, slack, etc.) a message originated from
ALTER TABLE messages ADD COLUMN channel_type TEXT;
ALTER TABLE messages ADD COLUMN channel_id TEXT;
