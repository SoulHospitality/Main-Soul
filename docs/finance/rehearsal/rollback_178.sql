-- Rollback 178: removes the reconciliation history table (Phase 7). Run BEFORE rollback_177.sql and rollback_176.sql.
-- The history is an audit record: if any run exists, it refuses unless confirmed:
--   SET app.confirm_rollback_178 = 'drop-reconciliation-history';
-- ORDER IN PRODUCTION: first redeploy an app build without 178_ledger_reconciliation_runs.sql, then run this.
BEGIN;
DO $$
DECLARE n bigint := 0;
BEGIN
  IF to_regclass('public.ledger_reconciliation_runs') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM public.ledger_reconciliation_runs' INTO n;
  END IF;
  IF n > 0 AND COALESCE(current_setting('app.confirm_rollback_178', true), '') <> 'drop-reconciliation-history' THEN
    RAISE EXCEPTION 'Refusing: % reconciliation runs are recorded. Set app.confirm_rollback_178 to confirm.', n;
  END IF;
END $$;
DROP TABLE IF EXISTS public.ledger_reconciliation_runs;
DROP FUNCTION IF EXISTS public.ledger_reconciliation_runs_append_only();
DELETE FROM public._schema_migrations WHERE id = '178_ledger_reconciliation_runs.sql';
COMMIT;
