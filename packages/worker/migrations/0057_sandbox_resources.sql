-- Add per-user sandbox resource preferences
ALTER TABLE users ADD COLUMN sandbox_cpu_cores REAL;
ALTER TABLE users ADD COLUMN sandbox_memory_mib INTEGER;
