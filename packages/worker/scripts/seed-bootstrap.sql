-- Bootstrap seed data for production
-- Creates a default admin user and API key
--
-- ============================================================================
-- BOOTSTRAP API KEY: sk_bootstrap_0000000000000000000000000000000000000000000000000000
-- ============================================================================
--
-- Use this key to authenticate with the API on first deployment.
-- After logging in, create a new API key through the UI and revoke this one!

-- Insert bootstrap user (idempotent - ignore if exists)
INSERT OR IGNORE INTO users (id, email, name, created_at)
VALUES ('bootstrap-admin', 'admin@agent-ops.local', 'Bootstrap Admin', datetime('now'));

-- Insert bootstrap API key (idempotent - ignore if exists)
-- Token: sk_bootstrap_0000000000000000000000000000000000000000000000000000
INSERT OR IGNORE INTO api_tokens (id, user_id, name, token_hash, prefix, created_at)
VALUES (
  'bootstrap-token',
  'bootstrap-admin',
  'Bootstrap Key (replace me!)',
  'a71a25c342f302475d452d50debd16fc25d060bb94fc9f86ccc32157721dd4fe',
  'sk_boot...0000',
  datetime('now')
);
