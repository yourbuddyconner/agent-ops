-- Add auth_required column to org_plugins (default true for backward compat)
ALTER TABLE org_plugins ADD COLUMN auth_required INTEGER NOT NULL DEFAULT 1;
