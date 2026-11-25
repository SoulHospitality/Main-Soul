-- Rehearsal r5: recovery from a failed migration. RESTORED COPY ONLY. Run with psql from the repository root
-- on a copy where 176 is NOT applied (after rollback_176.sql):
--   psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=0 -f docs/finance/rehearsal/r5_partial_failure.sql
-- It runs 176 the way the app does (one transaction), injects a failure after the last statement, and
-- shows that nothing is left behind. Then start the app normally: it applies 176 cleanly.
\set ON_ERROR_STOP 0
SET app.rehearsal_copy = 'restored-copy-not-production';
BEGIN;
\i Server/supabase/migrations/176_ledger_core.sql
DO $$ BEGIN RAISE EXCEPTION 'REHEARSAL: injected failure at the end of 176'; END $$;
COMMIT;   -- the transaction is aborted, so this rolls back

SELECT 'ledger tables left behind' AS check_name,
       (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ledger\_%') AS value,
       'must be 0' AS expected
UNION ALL
SELECT '176 recorded as applied', (SELECT COUNT(*) FROM public._schema_migrations WHERE id = '176_ledger_core.sql'), 'must be 0'
UNION ALL
SELECT 'ledger_posting setting', (SELECT COUNT(*) FROM public.financial_settings WHERE key = 'ledger_posting'), 'must be 0';
