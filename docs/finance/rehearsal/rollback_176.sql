-- Rollback 176: removes the ledger (tables, triggers, functions, sequence, posting switch).
-- Before cutover the ledger holds no real data (posting is off and the database refuses entries without
-- an approved policy), so this loses nothing. If ANY entry exists, it refuses unless confirmed:
--   SET app.confirm_rollback_176 = 'drop-ledger-with-entries';
-- After cutover, do NOT use this: switch reports back (LEDGER_SOURCE=computed) and post reversals instead.
-- ORDER IN PRODUCTION: first redeploy an app build without 176_ledger_core.sql, then run this.
BEGIN;
DO $$
DECLARE n bigint := 0;
BEGIN
  -- 178 (reconciliation history) and 177 (report source) depend on functions removed here: roll them back first.
  IF to_regclass('public.ledger_reconciliation_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing: migration 178 is still installed. Run rollback_178.sql first.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'financial_settings_ledger_reports_guard') THEN
    RAISE EXCEPTION 'Refusing: migration 177 is still installed. Run rollback_177.sql first.';
  END IF;
  IF to_regclass('public.ledger_entries') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM public.ledger_entries' INTO n;
  END IF;
  IF n > 0 AND COALESCE(current_setting('app.confirm_rollback_176', true), '') <> 'drop-ledger-with-entries' THEN
    RAISE EXCEPTION 'Refusing: the ledger holds % entries. Set app.confirm_rollback_176 to confirm.', n;
  END IF;
END $$;
-- DROP TABLE is not blocked by the row-level immutability triggers; it removes them with the tables.
DROP TRIGGER IF EXISTS financial_settings_ledger_posting_guard ON public.financial_settings;
DROP TRIGGER IF EXISTS financial_settings_no_truncate ON public.financial_settings;
DROP TRIGGER IF EXISTS financial_custom_accounts_ledger_sync ON public.financial_custom_accounts;
DROP TABLE IF EXISTS public.ledger_events, public.ledger_lines, public.ledger_entries, public.ledger_control_log, public.ledger_approvals, public.ledger_identity_keys,
                     public.ledger_periods, public.ledger_policies, public.ledger_accounts CASCADE;
DROP SEQUENCE IF EXISTS public.ledger_entry_number_seq;
DROP FUNCTION IF EXISTS public.ledger_entries_guard(), public.ledger_lines_guard(), public.ledger_entry_balance_check(),
                        public.ledger_entries_insert_guard(), public.ledger_lines_insert_guard(), public.ledger_policies_guard(),
                        public.ledger_periods_guard(), public.ledger_reversal_mirror_check(), public.ledger_control_log_append_only(),
                        public.ledger_posting_switch_guard(), public.ledger_is_active_admin(integer),
                        public.ledger_policy_in_force(date), public.ledger_no_truncate(), public.ledger_accounts_guard(),
                        public.ledger_sync_custom_account(), public.ledger_identity_keys_guard(), public.ledger_hmac_sha256(bytea, bytea),
                        public.ledger_verified_actor(), public.ledger_require_actor(integer, text), public.ledger_approvals_guard(),
                        public.ledger_has_approval(text, text, integer);
DELETE FROM public.financial_settings WHERE key = 'ledger_posting';
DELETE FROM public._schema_migrations WHERE id = '176_ledger_core.sql';
SELECT 'migration 176 removed' AS result;
COMMIT;
