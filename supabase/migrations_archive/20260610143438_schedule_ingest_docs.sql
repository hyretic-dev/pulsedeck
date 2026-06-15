-- Enable the required extensions for network requests and cron jobs
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Unschedule just in case it already exists to ensure idempotency
SELECT cron.unschedule('invoke-ingest-docs-daily');

-- Schedule the ingest-docs edge function to run every night at 3:00 AM
SELECT
  cron.schedule(
    'invoke-ingest-docs-daily',
    '0 3 * * *',
    $$
    SELECT
      net.http_get(
          url:='https://dniozpfdldgtvpaehuux.supabase.co/functions/v1/ingest-docs'
      ) as request_id;
    $$
  );
