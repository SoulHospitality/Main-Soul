-- Fourth Financial System restart (requested 12 Nov 2026). Same scope as 116 / 125 / 140:
-- finance-only records are wiped; operational records (reservations, payments, expenses, petty cash entries)
-- stay but are ignored by the Financial System because they predate the new books_reset_at.
-- This time pending refund requests and the Reservation collection queue are cleared too.
-- Opening position: Bank ADIB 939,418.49 · Bank CIB 147,732.00 · Cash EGP 22,974.27 ·
-- Petty cash North Coast 0 · Sokhna 2,707.00. Balancing side of every opening entry is 302000.

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
    'reservation_cancel_requests'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM public.%I', t);
    END IF;
  END LOOP;

  IF to_regclass('public.financial_recurring_charges') IS NOT NULL THEN
    UPDATE public.financial_recurring_charges SET is_active = 0, updated_at = now();
  END IF;

  -- Reservation collection starts empty: nothing waiting, no old check history.
  UPDATE public.payments SET finance_review_status = NULL WHERE finance_review_status IS NOT NULL;

  -- Petty cash: every drawer starts from its new opening; old entries predate the reset and drop out.
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

INSERT INTO public.financial_manual_entries
  (entry_type, misc_flow, description, amount, entry_date, notes, debit_account_code, credit_account_code)
VALUES
  ('journal', NULL, 'Opening balance - Bank ADIB', 939418.49, CURRENT_DATE, 'Restart Nov 2026 - Bank ADIB', '101000', '302000'),
  ('journal', NULL, 'Opening balance - Bank CIB', 147732.00, CURRENT_DATE, 'Restart Nov 2026 - Bank CIB', '102000', '302000'),
  ('journal', NULL, 'Opening balance - Cash EGP', 22974.27, CURRENT_DATE, 'Restart Nov 2026 - Cash EGP', '103000', '302000');

INSERT INTO public.petty_cash_settings (location, opening_balance, updated_at)
VALUES ('north_coast', 0, now()), ('sokhna', 2707, now())
ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now();

DO $$
DECLARE
  drawer text;
BEGIN
  IF to_regclass('public.petty_cash_accounts') IS NOT NULL THEN
    UPDATE public.petty_cash_accounts SET opening_amount = 2707 WHERE location_key = 'sokhna';
    SELECT account_code INTO drawer FROM public.petty_cash_accounts WHERE location_key = 'sokhna' AND account_code IS NOT NULL LIMIT 1;
  END IF;
  -- The Sokhna float also sits in the books, in its own drawer account under Petty Cash.
  INSERT INTO public.financial_manual_entries
    (entry_type, misc_flow, description, amount, entry_date, notes, debit_account_code, credit_account_code)
  VALUES ('journal', NULL, 'Opening balance - Petty cash Sokhna', 2707.00, CURRENT_DATE, 'Restart Nov 2026 - Petty cash Sokhna',
          COALESCE(drawer, '108000'), '302000');
END $$;
