-- Add prefix column to api_tokens for displaying masked key previews
ALTER TABLE api_tokens ADD COLUMN prefix TEXT;

-- Create index for looking up tokens by prefix
CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(prefix);
