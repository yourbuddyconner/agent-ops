-- Add author_avatar_url to D1 messages table (already exists in DO SQLite)
ALTER TABLE messages ADD COLUMN author_avatar_url TEXT;
