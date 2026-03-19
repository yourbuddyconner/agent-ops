-- Add enabled_login_providers to org_settings (JSON array of provider IDs, null = all enabled)
ALTER TABLE org_settings ADD COLUMN enabled_login_providers TEXT DEFAULT NULL;
