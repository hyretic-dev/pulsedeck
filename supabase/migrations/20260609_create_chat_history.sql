-- SQL Migration: 20260609_create_chat_history.sql
-- Erstellt Tabellen zur Persistierung des Chatverlaufs für den Onboarding-Chatbot

-- 1. Chat Sessions Tabelle
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index für Performance
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_org ON chat_sessions(organization_id);

-- RLS aktivieren
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies für chat_sessions
DROP POLICY IF EXISTS "Users can manage their own chat sessions" ON chat_sessions;
CREATE POLICY "Users can manage their own chat sessions" ON chat_sessions
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- 2. Chat Messages Tabelle
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index für Performance
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);

-- RLS aktivieren
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies für chat_messages
DROP POLICY IF EXISTS "Users can manage messages in their sessions" ON chat_messages;
CREATE POLICY "Users can manage messages in their sessions" ON chat_messages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_sessions 
      WHERE chat_sessions.id = chat_messages.session_id 
      AND chat_sessions.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_sessions 
      WHERE chat_sessions.id = chat_messages.session_id 
      AND chat_sessions.user_id = auth.uid()
    )
  );
