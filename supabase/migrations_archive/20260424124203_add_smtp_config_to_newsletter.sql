ALTER TABLE newsletter_config
ADD COLUMN smtp_host text,
ADD COLUMN smtp_port integer,
ADD COLUMN smtp_user text,
ADD COLUMN smtp_pass text,
ADD COLUMN smtp_from text,
ADD COLUMN smtp_secure boolean DEFAULT true;
