-- Create active_sessions table for database heartbeat presence
CREATE TABLE IF NOT EXISTS active_sessions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    org_roles JSONB DEFAULT '{}'::jsonb,
    current_path TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE active_sessions ENABLE ROW LEVEL SECURITY;

-- Allow users to upsert their own session
CREATE POLICY "Users can manage their own active session" 
ON active_sessions 
FOR ALL 
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Allow everyone to view active sessions (only admins will access the UI anyway)
CREATE POLICY "Anyone can view active sessions" 
ON active_sessions 
FOR SELECT 
USING (true);

-- Create an index to quickly find recent sessions by org
CREATE INDEX IF NOT EXISTS idx_active_sessions_last_seen ON active_sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_active_sessions_org_roles ON active_sessions USING GIN (org_roles);
