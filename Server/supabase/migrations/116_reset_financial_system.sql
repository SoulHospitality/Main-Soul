-- One-time reset: the Financial System starts from zero at the moment this migration runs.
-- Finance-only records are deleted. Operational records (reservations, payments, expenses,
-- petty cash, housekeeping orders, owner payout requests) are kept, but the Financial System
-- ignores anything created before books_reset_at.
-- Setup is kept: vendor directory, financial settings, close checklist templates.
-- Monthly recurring charges are switched off so they don't post until re-enabled.

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

  IF to_regclass('public.financial_recurring_charges') IS NOT NULL THEN
    UPDATE public.financial_recurring_charges SET is_active = 0, updated_at = now();
  END IF;
END $$;

INSERT INTO public.financial_settings (key, value_text, updated_at)
VALUES ('books_reset_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = now();
