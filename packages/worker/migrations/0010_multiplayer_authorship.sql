-- Add author tracking columns to messages table
ALTER TABLE messages ADD COLUMN author_id TEXT REFERENCES users(id);
ALTER TABLE messages ADD COLUMN author_email TEXT;
ALTER TABLE messages ADD COLUMN author_name TEXT;
