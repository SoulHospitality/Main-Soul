-- Opening position as of 6 Oct 2026, from Finance.xlsx and Petty Cash Sokhna.xlsx.
-- Balancing side of every opening entry is 302000 Retained Earnings.

ALTER TABLE public.financial_manual_entries
  ALTER COLUMN amount TYPE numeric(14, 2);

INSERT INTO public.financial_custom_accounts (code, name, account_group, parent_code) VALUES
  ('101001', 'Bank - ADIB (EGP)', 'assets', '101000'),
  ('101002', 'Bank - CIB (EGP)', 'assets', '101000'),
  ('110001', 'Recoverable - Tatweer Misr custody (Sokhna)', 'assets', '110000')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.financial_manual_entries
  (entry_type, misc_flow, description, amount, entry_date, notes, debit_account_code, credit_account_code)
VALUES
  ('journal', NULL, 'Opening balance - ADIB bank', 1827747.58, '2026-10-06',
   'Finance.xlsx - Daily Cash (رصيد بنك ADIB)', '101001', '302000'),
  ('journal', NULL, 'Opening balance - CIB bank', 147732.00, '2026-10-06',
   'Finance.xlsx - Daily Cash (رصيد بنك CIB)', '101002', '302000'),
  ('journal', NULL, 'Opening balance - cash on hand', 0.11, '2026-10-06',
   'Finance.xlsx - Daily Cash (رصيد الخزينة)', '103000', '302000'),
  ('journal', NULL, 'Opening balance - sales commissions owed to staff', 743050.08, '2026-10-06',
   'Finance.xlsx - Commissions (collected deals, balance still to pay)', '302000', '209000'),
  ('journal', NULL, 'Opening balance - Tatweer Misr custody to recover', 23546.00, '2026-10-06',
   'Petty Cash Sokhna.xlsx - Petty Cash (Tatweer)', '110001', '302000');

INSERT INTO public.petty_cash_settings (location, opening_balance, updated_at)
VALUES ('sokhna', -5283, now())
ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now();

-- Expected cash flow (Finance.xlsx - Cashflow Expected). Items dated 30 Sep 2026 are still open,
-- so they sit in the week of 5 Oct; advances recovered in December sit in the week of 30 Nov.
INSERT INTO public.cash_forecast_entries (week_start, category, amount, notes) VALUES
  ('2026-10-05', 'other_in', 200000, 'Refund from Abdallah Shaheen (مبلغ مسترد من عبدلله شاهين)'),
  ('2026-10-05', 'other_in', 96110, 'Remaining owners 8-2026 + 9-2026'),
  ('2026-10-05', 'other_out', 267875, 'Commission - Habiba Samy'),
  ('2026-10-05', 'vendor_payments', 1122218, 'Tatweer Misr'),
  ('2026-10-05', 'vendor_payments', 150000, 'Rent New Cairo'),
  ('2026-10-05', 'tax', 600000, 'Remaining tax'),
  ('2026-10-05', 'other_out', 92000, 'Deal commission - resale Fouka'),
  ('2026-10-05', 'vendor_payments', 110000, 'Remaining audit'),
  ('2026-10-05', 'other_out', 60000, 'Tatweer commission Sokhna (4-5-6-7-8-9)'),
  ('2026-10-05', 'other_out', 63000, 'Remaining commission (OS&NB)'),
  ('2026-10-05', 'owner_payouts', 61768, 'Owners statement Sokhna (9-2026)'),
  ('2026-11-30', 'other_in', 250000, 'Advance to Mohamed Abdelrahman - recovered in December'),
  ('2026-11-30', 'other_in', 100000, 'Advance to Sameh Mohamed - recovered in December');
