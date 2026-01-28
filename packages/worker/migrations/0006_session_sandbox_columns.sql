-- Add sandbox tracking columns to sessions table.
-- sandbox_id: Modal sandbox identifier for lifecycle management
-- tunnel_urls: JSON object with tunnel URLs { opencode, gateway, vscode, vnc, ttyd }

ALTER TABLE sessions ADD COLUMN sandbox_id TEXT;
ALTER TABLE sessions ADD COLUMN tunnel_urls TEXT;
