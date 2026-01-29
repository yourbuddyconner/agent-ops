-- Add GitHub OAuth columns to users table.
-- github_id: unique GitHub user ID for OAuth identity mapping
-- github_username: for git config (user.name) inside sandboxes

ALTER TABLE users ADD COLUMN github_id TEXT;
ALTER TABLE users ADD COLUMN github_username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_github_id ON users(github_id);
