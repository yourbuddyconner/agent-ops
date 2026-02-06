-- Add model_preferences column to users table
-- Stores a JSON array of model IDs in priority order for failover
-- e.g. ["anthropic/claude-sonnet-4-5-20250929", "openai/gpt-4o", "google/gemini-2.5-pro"]
ALTER TABLE users ADD COLUMN model_preferences TEXT;
