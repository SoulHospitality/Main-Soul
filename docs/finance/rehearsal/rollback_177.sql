-- Rollback 177: removes the report-source switch (Phase 6). Run BEFORE rollback_176.sql.
-- Refuses while reports read the stored ledger: switch them back to 'engine' first (verified admin, logged;
-- reportSource.setReportSource), so the app is never left reading a source that is being removed.
-- ORDER IN PRODUCTION: first redeploy an app build without 177_ledger_report_source.sql, then run this.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.financial_settings WHERE key = 'ledger_reports' AND value_text = 'ledger') THEN
    RAISE EXCEPTION 'Refusing: reports still read the stored ledger. Switch the report source back to engine first.';
  END IF;
END $$;
DROP TRIGGER IF EXISTS financial_settings_ledger_reports_guard ON public.financial_settings;
DROP TRIGGER IF EXISTS financial_settings_ledger_posting_off_guard ON public.financial_settings;
DROP FUNCTION IF EXISTS public.ledger_report_source_guard(), public.ledger_posting_off_guard();
DELETE FROM public.financial_settings WHERE key = 'ledger_reports';
-- The control-log rows about the report source stay (append-only history); rollback_176 removes the log itself.
DELETE FROM public._schema_migrations WHERE id = '177_ledger_report_source.sql';
COMMIT;
