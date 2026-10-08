-- Second Financial System restart, as of 8 Oct 2026, from Finance (1).xlsx and Petty Cash Sokhna (2).xlsx.
-- Treasuries are now Bank ADIB 101000, Bank CIB 102000, Cash EGP 103000 and Cash USD 104000 (booked in EGP).
-- Reservations get a currency (EGP or USD with its exchange rate) and the bank account used for InstaPay.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS currency varchar(3) NOT NULL DEFAULT 'EGP',
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(12, 4),
  ADD COLUMN IF NOT EXISTS bank_account varchar(10);

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS bank_account varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_currency_check') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_currency_check CHECK (currency IN ('EGP', 'USD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_bank_account_check') THEN
    ALTER TABLE public.reservations
      ADD CONSTRAINT reservations_bank_account_check CHECK (bank_account IS NULL OR bank_account IN ('adib', 'cib'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_bank_account_check') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_bank_account_check CHECK (bank_account IS NULL OR bank_account IN ('adib', 'cib'));
  END IF;
END $$;

-- Wipe every finance-only record (same scope as migration 116); operational records stay but are
-- ignored by the Financial System because they predate the new books_reset_at.
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

  IF to_regclass('public.close_checklist_templates') IS NOT NULL THEN
    UPDATE public.close_checklist_templates
      SET description = 'Reconcile Bank ADIB (101000) and Bank CIB (102000) against bank statements'
      WHERE title = 'Bank reconciliation';
    UPDATE public.close_checklist_templates
      SET description = 'Count and reconcile Cash EGP (103000) and Cash USD (104000)'
      WHERE title = 'Cash reconciliation';
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
  ('journal', NULL, 'Opening balance - Bank ADIB', 1974602.27, '2026-10-08',
   'Finance (1).xlsx - Daily Cash (رصيد بنك ADIB)', '101000', '302000'),
  ('journal', NULL, 'Opening balance - Bank CIB', 147732.00, '2026-10-08',
   'Finance (1).xlsx - Daily Cash (رصيد بنك CIB)', '102000', '302000'),
  ('journal', NULL, 'Opening balance - Cash EGP', 0.11, '2026-10-08',
   'Finance (1).xlsx - Daily Cash (رصيد الخزينة)', '103000', '302000'),
  ('journal', NULL, 'Opening balance - sales commissions owed to staff', 743050.08, '2026-10-08',
   'Finance (1).xlsx - Commissions (collected deals, balance still to pay)', '302000', '209000'),
  ('journal', NULL, 'Opening balance - Tatweer Misr custody to recover', 23888.00, '2026-10-08',
   'Petty Cash Sokhna (2).xlsx - Petty Cash (Tatweer)', '110001', '302000');

INSERT INTO public.petty_cash_settings (location, opening_balance, updated_at)
VALUES ('sokhna', 15575, now())
ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now();

-- Expected cash flow (Finance (1).xlsx - Cashflow Expected). Items dated 31 Oct 2026 sit in the week of
-- 26 Oct; advances recovered in December sit in the week of 30 Nov.
INSERT INTO public.cash_forecast_entries (week_start, category, amount, notes) VALUES
  ('2026-10-26', 'other_in', 200000, 'Refund from Abdallah Shaheen (مبلغ مسترد من عبدلله شاهين)'),
  ('2026-10-26', 'other_out', 267875, 'Commission - Habiba Samy'),
  ('2026-10-26', 'vendor_payments', 1122218, 'Tatweer Misr'),
  ('2026-10-26', 'tax', 600000, 'Remaining tax'),
  ('2026-10-26', 'other_in', 96110, 'Remaining owners 8-2026 + 9-2026'),
  ('2026-10-26', 'other_out', 92000, 'Deal commission - resale Fouka'),
  ('2026-10-26', 'vendor_payments', 110000, 'Remaining audit'),
  ('2026-10-26', 'other_out', 60000, 'Tatweer commission Sokhna (4-5-6-7-8-9)'),
  ('2026-10-26', 'other_out', 63000, 'Remaining commission (OS&NB)'),
  ('2026-10-26', 'other_in', 371800, 'Royal'),
  ('2026-10-26', 'other_in', 277924, 'Royal'),
  ('2026-10-26', 'other_in', 2000, 'From Abdelrahman Shaheen'),
  ('2026-11-30', 'other_in', 250000, 'Advance to Mohamed Abdelrahman - recovered in December'),
  ('2026-11-30', 'other_in', 100000, 'Advance to Sameh Mohamed - recovered in December');
