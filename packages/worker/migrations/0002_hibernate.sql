-- Add idle timeout preference to users
ALTER TABLE users ADD COLUMN idle_timeout_seconds INTEGER DEFAULT 900;

-- Add snapshot image ID to sessions for hibernate/restore
ALTER TABLE sessions ADD COLUMN snapshot_image_id TEXT;
