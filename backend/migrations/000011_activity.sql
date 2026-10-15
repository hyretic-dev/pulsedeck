-- Up migration
-- Onboarding, Aufgaben, Analytics, Audit, Feedback, Presence, Chat.

CREATE TABLE onboarding_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    step_key text NOT NULL,
    completed_at timestamp with time zone DEFAULT now()
);

CREATE TABLE user_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    member_id uuid NOT NULL,
    title text NOT NULL,
    done boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE analytics_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_name text NOT NULL,
    organization_id uuid,
    page_path text,
    meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    table_name text NOT NULL,
    operation text NOT NULL,
    record_id uuid,
    old_data jsonb,
    new_data jsonb,
    performed_by uuid,
    organization_id uuid
);

CREATE TABLE feedback_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    type text NOT NULL,
    description text NOT NULL,
    user_id uuid,
    status text DEFAULT 'new'::text
);

CREATE TABLE active_sessions (
    user_id uuid NOT NULL,
    name text NOT NULL,
    org_roles jsonb DEFAULT '{}'::jsonb,
    current_path text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE chat_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text, 'tool'::text])))
);

ALTER TABLE ONLY onboarding_progress
    ADD CONSTRAINT onboarding_progress_member_id_step_key_key UNIQUE (member_id, step_key);

ALTER TABLE ONLY onboarding_progress
    ADD CONSTRAINT onboarding_progress_pkey PRIMARY KEY (id);

ALTER TABLE ONLY user_tasks
    ADD CONSTRAINT user_tasks_pkey PRIMARY KEY (id);

ALTER TABLE ONLY analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);

ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

ALTER TABLE ONLY feedback_submissions
    ADD CONSTRAINT feedback_submissions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY active_sessions
    ADD CONSTRAINT active_sessions_pkey PRIMARY KEY (user_id);

ALTER TABLE ONLY chat_sessions
    ADD CONSTRAINT chat_sessions_pkey PRIMARY KEY (id);

ALTER TABLE ONLY chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);

CREATE INDEX idx_onboarding_progress_member_id ON onboarding_progress USING btree (member_id);

CREATE INDEX idx_user_tasks_member_id ON user_tasks USING btree (member_id);

CREATE INDEX idx_analytics_event_name ON analytics_events USING btree (event_name);

CREATE INDEX idx_analytics_org_created ON analytics_events USING btree (organization_id, created_at DESC);

CREATE INDEX idx_audit_logs_created_at ON audit_logs USING btree (created_at DESC);

CREATE INDEX idx_audit_logs_org ON audit_logs USING btree (organization_id);

CREATE INDEX idx_audit_logs_table ON audit_logs USING btree (table_name);

CREATE INDEX idx_active_sessions_last_seen ON active_sessions USING btree (last_seen_at);

CREATE INDEX idx_active_sessions_org_roles ON active_sessions USING gin (org_roles);

CREATE INDEX idx_chat_sessions_org ON chat_sessions USING btree (organization_id);

CREATE INDEX idx_chat_sessions_user ON chat_sessions USING btree (user_id);

CREATE INDEX idx_chat_messages_session ON chat_messages USING btree (session_id);

ALTER TABLE ONLY onboarding_progress
    ADD CONSTRAINT onboarding_progress_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY user_tasks
    ADD CONSTRAINT user_tasks_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

ALTER TABLE ONLY analytics_events
    ADD CONSTRAINT analytics_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;

ALTER TABLE ONLY feedback_submissions
    ADD CONSTRAINT feedback_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth_users(id);

ALTER TABLE ONLY active_sessions
    ADD CONSTRAINT active_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY chat_sessions
    ADD CONSTRAINT chat_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE ONLY chat_sessions
    ADD CONSTRAINT chat_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE;

ALTER TABLE ONLY chat_messages
    ADD CONSTRAINT chat_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE;

GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_progress, user_tasks, analytics_events, audit_logs, feedback_submissions, active_sessions, chat_sessions, chat_messages TO pulsedeck_runtime;


-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON onboarding_progress, user_tasks, analytics_events, audit_logs, feedback_submissions, active_sessions, chat_sessions, chat_messages FROM pulsedeck_runtime;
DROP TABLE chat_messages;
DROP TABLE chat_sessions;
DROP TABLE active_sessions;
DROP TABLE feedback_submissions;
DROP TABLE audit_logs;
DROP TABLE analytics_events;
DROP TABLE user_tasks;
DROP TABLE onboarding_progress;
