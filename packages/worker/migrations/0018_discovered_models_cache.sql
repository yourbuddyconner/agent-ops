-- Cache discovered models per user so the typeahead works without a running session.
-- Stores the JSON array from OpenCode provider discovery (same shape as DO state).
ALTER TABLE users ADD COLUMN discovered_models TEXT;
