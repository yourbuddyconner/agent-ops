-- Add persona_id column to orchestrator_identities
-- Links orchestrator to a real agentPersonas row for skill attachments
ALTER TABLE orchestrator_identities ADD COLUMN persona_id TEXT;
