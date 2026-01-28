-- Migration: Switch from Cloudflare Containers to Modal Sandboxes
-- Add columns for Modal sandbox management

-- Add tunnel_url for storing Modal tunnel URLs
ALTER TABLE containers ADD COLUMN tunnel_url TEXT;

-- Add sandbox_id for storing Modal sandbox IDs (repurposing container_id semantically)
ALTER TABLE containers ADD COLUMN sandbox_id TEXT;
