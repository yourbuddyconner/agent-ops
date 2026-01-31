-- Track cumulative sandbox running time (excludes hibernated/terminated time)
ALTER TABLE sessions ADD COLUMN active_seconds INTEGER NOT NULL DEFAULT 0;
