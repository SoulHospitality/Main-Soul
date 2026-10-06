-- One-time reset of Financial System data so books restart from 2026-10-01 with fresh figures.
-- Operational data (reservations, payments, expenses, petty cash, housekeeping orders) is kept;
-- the Financial System simply stops counting it before its new start date.
-- Setup is kept: vendor directory, recurring charge settings, financial settings, close checklist templates.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'payment_run_items',
    'payment_runs',
    'vendor_invoices',
    'fixed_asset_depreciation',
    'fixed_assets',
    'ar_collection_actions',
    'ar_bad_debt_provisions',
    'ar_write_offs',
    'close_checklist_items',
    'cash_forecast_entries',
    'finance_calendar_payments',
    'financial_manual_entries',
    'financial_period_closes',
    'financial_reconciled_entries',
    'financial_bank_snapshots',
    'financial_owner_holdbacks',
    'financial_custom_accounts'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I', t);
    END IF;
  END LOOP;
END $$;
