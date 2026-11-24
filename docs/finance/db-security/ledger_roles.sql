-- Restricted application role (review finding H3 prerequisite, "restricted posting role").
--
-- Run by the database owner / DBA, AFTER migrations 175 and 176, with psql:
--   psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password="$SOUL_APP_PASSWORD" -f docs/finance/db-security/ledger_roles.sql
-- Idempotent: re-run it after every later migration (new tables then get their policy and grants).
--
-- Result:
--   soul_app  LOGIN, NOSUPERUSER, NOCREATEROLE, NOCREATEDB, NOREPLICATION, NOBYPASSRLS, owns nothing.
--             The application connects with DATABASE_URL as soul_app; migrations keep running as the owner
--             through MIGRATION_DATABASE_URL (Server/src/config/db.js).
--   Because soul_app owns no table it cannot ALTER, DROP, DISABLE TRIGGER, TRUNCATE (not granted) or set
--   session_replication_role, and it has NO access to ledger_identity_keys, so it cannot forge identity claims.
--   Ordinary application tables: full DML through row-level-security policies (RLS is on everywhere, 095).
--   Ledger tables: read, plus only the writes the posting service needs; every write is still checked by
--   the guard triggers (balance, immutability, policy in force, verified identity, approvals).

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'soul_app') THEN
    CREATE ROLE soul_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE soul_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
ALTER ROLE soul_app SET statement_timeout = '60s';

GRANT USAGE ON SCHEMA public TO soul_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO soul_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO soul_app;

-- 1. Ordinary application tables: SELECT/INSERT/UPDATE/DELETE and an allow-all RLS policy for soul_app.
DO $$
DECLARE r record;
  ledger text[] := ARRAY['ledger_accounts', 'ledger_policies', 'ledger_periods', 'ledger_entries', 'ledger_lines', 'ledger_events',
                         'ledger_control_log', 'ledger_identity_keys', 'ledger_approvals', 'reservation_commission_corrections'];
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    IF r.relname = ANY (ledger) THEN CONTINUE; END IF;
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO soul_app', r.relname);
    EXECUTE format('REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM soul_app', r.relname);
    EXECUTE format('DROP POLICY IF EXISTS soul_app_all ON public.%I', r.relname);
    EXECUTE format('CREATE POLICY soul_app_all ON public.%I FOR ALL TO soul_app USING (true) WITH CHECK (true)', r.relname);
  END LOOP;
END $$;
-- Views used by the app (e.g. reservation_commission_review).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'v' LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO soul_app', r.relname);
  END LOOP;
END $$;

-- 2. Ledger tables: read everything except the identity keys; write only what posting needs.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_accounts', 'ledger_policies', 'ledger_periods', 'ledger_entries', 'ledger_lines', 'ledger_events',
                           'ledger_control_log', 'ledger_approvals', 'reservation_commission_corrections'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM soul_app', t);
    EXECUTE format('GRANT SELECT ON public.%I TO soul_app', t);
    EXECUTE format('DROP POLICY IF EXISTS soul_app_read ON public.%I', t);
    EXECUTE format('CREATE POLICY soul_app_read ON public.%I FOR SELECT TO soul_app USING (true)', t);
  END LOOP;
END $$;
GRANT INSERT ON public.ledger_entries, public.ledger_lines, public.ledger_events, public.ledger_approvals TO soul_app;
GRANT UPDATE (status, reversed_by_id) ON public.ledger_entries TO soul_app;
GRANT UPDATE (status, error, entry_id, processed_at) ON public.ledger_events TO soul_app;
GRANT INSERT, UPDATE ON public.ledger_policies, public.ledger_periods TO soul_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_lines', 'ledger_events', 'ledger_approvals', 'ledger_policies', 'ledger_periods'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS soul_app_insert ON public.%I', t);
    EXECUTE format('CREATE POLICY soul_app_insert ON public.%I FOR INSERT TO soul_app WITH CHECK (true)', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['ledger_entries', 'ledger_events', 'ledger_policies', 'ledger_periods'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS soul_app_update ON public.%I', t);
    EXECUTE format('CREATE POLICY soul_app_update ON public.%I FOR UPDATE TO soul_app USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- 3. The identity key table: no grant, no policy. Only its owner and the SECURITY DEFINER check read it.
REVOKE ALL ON public.ledger_identity_keys FROM soul_app;
REVOKE ALL ON public.ledger_identity_keys FROM PUBLIC;
DROP POLICY IF EXISTS soul_app_all ON public.ledger_identity_keys;

-- 4. Future objects created by the owner: soul_app gets ordinary DML on new tables (re-run this script to add
--    their RLS policy).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soul_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO soul_app;

COMMIT;

-- Check (as the owner): soul_app is restricted.
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = 'soul_app';
SELECT has_table_privilege('soul_app', 'public.ledger_identity_keys', 'SELECT') AS can_read_identity_keys,
       has_table_privilege('soul_app', 'public.ledger_entries', 'TRUNCATE') AS can_truncate_entries,
       has_table_privilege('soul_app', 'public.ledger_entries', 'DELETE') AS can_delete_entries;
