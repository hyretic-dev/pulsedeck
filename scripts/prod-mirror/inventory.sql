-- Inventar der Produktionsdatenbank: alles, was im Repo nicht (mehr) sichtbar ist (Realtime-Publication, pg_cron, Trigger,
-- Funktionen, Dashboard-Tabellen, Buckets, Auth-Bestand). Rein lesend; schreibt je Thema eine TSV-Datei nach :outdir.
-- Aufruf durch capture.sh:  psql -X -v ON_ERROR_STOP=0 -v outdir=/out/inventory -f inventory.sql
-- Es werden nur Zähler, Namen und Strukturen ausgegeben, nie Zeilen, Hashes, Tokens oder Schlüssel
-- (Befehlstexte von Cron-Jobs werden um tokenartige Zeichenketten bereinigt).
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
\pset footer off

\o :outdir/server.tsv
SELECT 'version', current_setting('server_version') UNION ALL
SELECT 'version_num', current_setting('server_version_num') UNION ALL
SELECT 'database', current_database() UNION ALL
SELECT 'role', current_user UNION ALL
SELECT 'is_superuser', current_setting('is_superuser') UNION ALL
SELECT 'size_bytes', pg_database_size(current_database())::text;

\o :outdir/extensions.tsv
SELECT extname, extversion, extnamespace::regnamespace::text FROM pg_extension ORDER BY 1;

\o :outdir/tables.tsv
SELECT n.nspname, c.relname, c.relkind, c.reltuples::bigint, c.relrowsecurity,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname IN ('public', 'auth', 'storage', 'realtime', 'supabase_functions', 'supabase_migrations')
 ORDER BY 1, 2;

\o :outdir/columns.tsv
SELECT table_name, column_name, udt_name, is_nullable, coalesce(column_default, '')
  FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;

\o :outdir/publications.tsv
SELECT p.pubname, p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete, coalesce(t.schemaname || '.' || t.tablename, '') AS tabelle
  FROM pg_publication p LEFT JOIN pg_publication_tables t ON t.pubname = p.pubname ORDER BY 1, 6;

\o :outdir/triggers.tsv
SELECT c.relnamespace::regnamespace::text || '.' || c.relname AS tabelle, t.tgname, pg_get_triggerdef(t.oid) AS definition
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE NOT t.tgisinternal AND c.relnamespace::regnamespace::text IN ('public', 'auth', 'storage', 'realtime') ORDER BY 1, 2;

\o :outdir/functions.tsv
SELECT p.pronamespace::regnamespace::text, p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
  FROM pg_proc p
 WHERE p.pronamespace::regnamespace::text IN ('public', 'auth', 'storage', 'realtime', 'supabase_functions')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
 ORDER BY 1, 2;

\o :outdir/policies.tsv
SELECT schemaname, tablename, policyname, cmd, roles::text FROM pg_policies WHERE schemaname IN ('public', 'storage') ORDER BY 1, 2, 3;

-- pg_cron: nur Name, Zeitplan, Aktivität und der bereinigte Befehl
SELECT to_regclass('cron.job') IS NOT NULL AS has_cron \gset
\if :has_cron
\o :outdir/cron.tsv
SELECT jobid, coalesce(jobname, ''), schedule, active, left(regexp_replace(regexp_replace(command, '[A-Za-z0-9_.-]{30,}', '[bereinigt]', 'g'), '\s+', ' ', 'g'), 400) FROM cron.job ORDER BY 1;
\endif

SELECT to_regclass('storage.buckets') IS NOT NULL AS has_storage \gset
\if :has_storage
\o :outdir/buckets.tsv
SELECT b.id, b.public, coalesce(b.file_size_limit::text, ''), coalesce(b.allowed_mime_types::text, ''),
       count(o.id), coalesce(sum((o.metadata ->> 'size')::bigint), 0)
  FROM storage.buckets b LEFT JOIN storage.objects o ON o.bucket_id = b.id GROUP BY b.id, b.public, b.file_size_limit, b.allowed_mime_types ORDER BY 1;
\endif

SELECT to_regclass('auth.users') IS NOT NULL AS has_auth \gset
\if :has_auth
\o :outdir/auth.tsv
SELECT 'users', count(*) FROM auth.users UNION ALL
SELECT 'users_deleted', count(*) FROM auth.users WHERE deleted_at IS NOT NULL UNION ALL
SELECT 'users_without_email', count(*) FROM auth.users WHERE email IS NULL UNION ALL
SELECT 'users_unconfirmed', count(*) FROM auth.users WHERE email_confirmed_at IS NULL UNION ALL
SELECT 'users_banned', count(*) FROM auth.users WHERE banned_until IS NOT NULL AND banned_until > now() UNION ALL
SELECT 'users_without_password', count(*) FROM auth.users WHERE coalesce(encrypted_password, '') = '';
-- Hash-Format ohne Hash: nur Präfix (Algorithmus und Kostenfaktor), z. B. $2a$10
\o :outdir/hash-formats.tsv
SELECT substring(encrypted_password from 1 for 6) AS format, count(*) FROM auth.users WHERE coalesce(encrypted_password, '') <> '' GROUP BY 1 ORDER BY 2 DESC;
\endif

SELECT to_regclass('auth.identities') IS NOT NULL AS has_identities \gset
\if :has_identities
\o :outdir/identities.tsv
SELECT provider, count(*) FROM auth.identities GROUP BY 1 ORDER BY 2 DESC;
\endif

SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS has_migrations \gset
\if :has_migrations
\o :outdir/migrations.tsv
SELECT version, coalesce(name, '') FROM supabase_migrations.schema_migrations ORDER BY 1;
\endif

\o
