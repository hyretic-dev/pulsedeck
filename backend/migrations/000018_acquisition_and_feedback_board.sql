-- Up migration
-- Herkunft und Pilot-Wunsch bei der Registrierung (nur an der Organisation, nie in öffentlichen Antworten) und
-- Feedback-Board für den Plattform-Admin: Quelle, eigentliches Problem, Thema, Entscheidung und Rückmeldung.

ALTER TABLE organizations
  ADD COLUMN acquisition_source text
    CONSTRAINT organizations_acquisition_source_check CHECK (acquisition_source IN
      ('workshop', 'empfehlung', 'suche', 'blog', 'event_gast', 'social', 'sonstiges')),
  ADD COLUMN acquisition_ref text
    CONSTRAINT organizations_acquisition_ref_check CHECK (acquisition_ref ~ '^[a-z0-9_-]{1,40}$'),
  ADD COLUMN pilot_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN pilot_wish text
    CONSTRAINT organizations_pilot_wish_check CHECK (char_length(pilot_wish) <= 300);

ALTER TABLE feedback_submissions DROP CONSTRAINT feedback_status_check;
ALTER TABLE feedback_submissions ADD CONSTRAINT feedback_status_check CHECK (status IN ('new', 'in_progress', 'done', 'live'));

ALTER TABLE feedback_submissions
  ADD COLUMN source text NOT NULL DEFAULT 'app'
    CONSTRAINT feedback_source_check CHECK (source IN ('app', 'gespraech', 'mail')),
  ADD COLUMN problem text
    CONSTRAINT feedback_problem_check CHECK (char_length(problem) <= 2000),
  ADD COLUMN topic text
    CONSTRAINT feedback_topic_check CHECK (topic ~ '^[a-z0-9-]{1,60}$'),
  ADD COLUMN blocks_activation boolean NOT NULL DEFAULT false,
  ADD COLUMN decision text
    CONSTRAINT feedback_decision_check CHECK (decision IN ('bauen', 'parken', 'abgelehnt')),
  ADD COLUMN reply_text text
    CONSTRAINT feedback_reply_check CHECK (char_length(reply_text) <= 3000),
  ADD COLUMN replied_at timestamptz;

CREATE INDEX idx_feedback_topic ON feedback_submissions (topic) WHERE topic IS NOT NULL;

-- Down migration
DROP INDEX idx_feedback_topic;
ALTER TABLE feedback_submissions
  DROP COLUMN replied_at,
  DROP COLUMN reply_text,
  DROP COLUMN decision,
  DROP COLUMN blocks_activation,
  DROP COLUMN topic,
  DROP COLUMN problem,
  DROP COLUMN source;
UPDATE feedback_submissions SET status = 'done' WHERE status = 'live';
ALTER TABLE feedback_submissions DROP CONSTRAINT feedback_status_check;
ALTER TABLE feedback_submissions ADD CONSTRAINT feedback_status_check CHECK (status IN ('new', 'in_progress', 'done'));
ALTER TABLE organizations
  DROP COLUMN pilot_wish,
  DROP COLUMN pilot_requested,
  DROP COLUMN acquisition_ref,
  DROP COLUMN acquisition_source;
