-- Third Financial System restart, as of 2 Nov 2026, from Tresury.xlsx and Petty Cash.xlsx.
-- Same scope as migrations 116 and 125: finance-only records are wiped; operational records stay but
-- are ignored by the Financial System because they predate the new books_reset_at.
-- Only the final balances from the sheets are booked; no transaction history or cash forecast.

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

  IF to_regclass('public.petty_cash_settings') IS NOT NULL THEN
    UPDATE public.petty_cash_settings SET opening_balance = 0, updated_at = now();
  END IF;

  IF to_regclass('public.petty_cash_accounts') IS NOT NULL THEN
    UPDATE public.petty_cash_accounts SET opening_amount = 0;
  END IF;
END $$;

INSERT INTO public.financial_settings (key, value_text, updated_at)
VALUES ('books_reset_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text, updated_at = now();

-- Opening position. Balancing side of every opening entry is 302000 Retained Earnings.
INSERT INTO public.financial_custom_accounts (code, name, account_group, parent_code) VALUES
  ('110001', 'Recoverable - Tatweer Misr custody (Sokhna)', 'assets', '110000')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.financial_manual_entries
  (entry_type, misc_flow, description, amount, entry_date, notes, debit_account_code, credit_account_code)
VALUES
  ('journal', NULL, 'Opening balance - Bank ADIB', 1115289.49, '2026-11-02',
   'Tresury.xlsx - Daily Cash (رصيد بنك ADIB)', '101000', '302000'),
  ('journal', NULL, 'Opening balance - Bank CIB', 147732.00, '2026-11-02',
   'Tresury.xlsx - Daily Cash (رصيد بنك CIB)', '102000', '302000'),
  ('journal', NULL, 'Opening balance - Cash EGP', 22553.27, '2026-11-02',
   'Tresury.xlsx - Daily Cash (رصيد الخزينة) = Petty Cash Office', '103000', '302000'),
  ('journal', NULL, 'Opening balance - sales commissions owed to staff', 744871.07, '2026-11-02',
   'Tresury.xlsx - Commissions (collected deals 743,050.08 + hospitality Mostafa Ashraf 1,820.99, balance still to pay)',
   '302000', '209000'),
  ('journal', NULL, 'Opening balance - Tatweer Misr custody to recover', 26981.00, '2026-11-02',
   'Petty Cash.xlsx - Petty Cash (Tatweer)', '110001', '302000');

INSERT INTO public.petty_cash_settings (location, opening_balance, updated_at)
VALUES ('sokhna', 1968, now())
ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now();

DO $$
BEGIN
  IF to_regclass('public.petty_cash_accounts') IS NOT NULL THEN
    UPDATE public.petty_cash_accounts SET opening_amount = 1968 WHERE location_key = 'sokhna';
  END IF;
END $$;
