-- Add ref to session git state for tag/commit/branch refs
ALTER TABLE session_git_state ADD COLUMN ref TEXT;
