-- Add message_format column to messages table for V2 parts-based pipeline
ALTER TABLE messages ADD COLUMN message_format TEXT NOT NULL DEFAULT 'v1';
