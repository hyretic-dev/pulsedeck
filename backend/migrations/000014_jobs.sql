-- Up migration
-- Hintergrundarbeit: Mail-Outbox (Newsletter u. a.), Web-Push (Abonnements und Warteschlange), Scheduler-Zustand.
-- Ersetzt die Edge Functions send-newsletter/send-push/send-event-notification sowie pg_cron/pg_net.
-- Mehrere Backend-Instanzen dürfen parallel arbeiten: Zeilen werden per FOR UPDATE SKIP LOCKED beansprucht.

CREATE TABLE mail_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES organizations (id) ON DELETE CASCADE,
    kind text NOT NULL,
    recipient text NOT NULL,
    subject text NOT NULL,
    text_body text NOT NULL,
    html_body text NOT NULL,
    use_org_smtp boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'pending' CONSTRAINT mail_outbox_status_check CHECK (status IN ('pending', 'sent', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
);
CREATE INDEX idx_mail_outbox_due ON mail_outbox (next_attempt_at) WHERE status = 'pending';
CREATE INDEX idx_mail_outbox_org ON mail_outbox (organization_id, created_at DESC);

CREATE TABLE push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (member_id, endpoint)
);
CREATE INDEX idx_push_subscriptions_member ON push_subscriptions (member_id);

CREATE TABLE push_notification_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
    kind text NOT NULL CONSTRAINT push_queue_kind_check CHECK (kind IN ('event', 'feed')),
    ref_id uuid NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    url text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CONSTRAINT push_queue_status_check CHECK (status IN ('pending', 'sent', 'failed')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    locked_until timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz
);
CREATE INDEX idx_push_queue_due ON push_notification_queue (next_attempt_at) WHERE status = 'pending';

CREATE TABLE scheduler_state (
    name text PRIMARY KEY,
    last_run_at timestamptz NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON mail_outbox, push_subscriptions, push_notification_queue, scheduler_state TO pulsedeck_runtime;

-- Down migration
REVOKE SELECT, INSERT, UPDATE, DELETE ON mail_outbox, push_subscriptions, push_notification_queue, scheduler_state FROM pulsedeck_runtime;
DROP TABLE scheduler_state;
DROP TABLE push_notification_queue;
DROP TABLE push_subscriptions;
DROP TABLE mail_outbox;
