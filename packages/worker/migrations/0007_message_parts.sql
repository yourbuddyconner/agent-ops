-- Add structured parts column to messages table.
-- Stores JSON array of message parts (tool calls, code blocks, etc.)

ALTER TABLE messages ADD COLUMN parts TEXT;
