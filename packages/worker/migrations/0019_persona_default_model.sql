-- Add default_model column to agent_personas for per-persona model selection
ALTER TABLE agent_personas ADD COLUMN default_model TEXT;
