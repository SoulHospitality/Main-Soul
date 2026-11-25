-- Opening treasury balances for the books that start on 25 November 2026 (FINANCE_GO_LIVE.md §2 step 6).
-- Source: the owner's treasury sheets ("Finance" → Daily Cash / Petty Cash Office, and "Petty Cash Sokhna"),
-- read on 2026-11-25 after the day's last entries. Balances only: no individual transactions are imported.
--
--   Bank ADIB (101000)            631,317.71   Daily Cash, ADIB In − ADIB Out
--   Bank CIB (102000)             147,732.00   Daily Cash, CIB In − CIB Out
--   Cash EGP (103000)               4,753.27   Daily Cash cash column = Petty Cash Office closing balance
--   Petty cash Sokhna (108002)        424.00   Petty Cash Sokhna, last balance (24/11)
--   Petty cash North Coast (108001)     0.00   no sheet
--   Cash USD (104000)                   0.00   no sheet
--
-- Not entered: "Petty Cash (Tatweer)" shows −26,981.00 (no movement since July). A cash drawer cannot be negative;
-- it is money spent for Tatweer units and is a receivable or payable, not a treasury. Waiting for the owner.
--
-- Same pattern as migration 162 (the 12 Nov restart): one manual journal per treasury, Dr treasury / Cr 302000,
-- plus the petty cash drawer openings. The superseded 12 Nov opening journals are removed, so no report range
-- that includes 12 Nov counts the opening twice (a copy is kept in Main-Soul-preserved). Idempotent; one transaction.
BEGIN;

SELECT id, entry_date, description, amount FROM public.financial_manual_entries
WHERE description LIKE 'Opening balance - %' ORDER BY id;

DELETE FROM public.financial_manual_entries
WHERE description LIKE 'Opening balance - %' AND entry_date = DATE '2026-11-12' AND credit_account_code = '302000';

DELETE FROM public.financial_manual_entries
WHERE description LIKE 'Opening balance - %' AND entry_date = DATE '2026-11-25' AND notes LIKE 'Books from 25 Nov 2026 - %';

INSERT INTO public.financial_manual_entries
  (entry_type, misc_flow, description, amount, entry_date, notes, debit_account_code, credit_account_code)
VALUES
  ('journal', NULL, 'Opening balance - Bank ADIB', 631317.71, DATE '2026-11-25', 'Books from 25 Nov 2026 - Bank ADIB', '101000', '302000'),
  ('journal', NULL, 'Opening balance - Bank CIB', 147732.00, DATE '2026-11-25', 'Books from 25 Nov 2026 - Bank CIB', '102000', '302000'),
  ('journal', NULL, 'Opening balance - Cash EGP', 4753.27, DATE '2026-11-25', 'Books from 25 Nov 2026 - Cash EGP', '103000', '302000'),
  ('journal', NULL, 'Opening balance - Petty cash Sokhna', 424.00, DATE '2026-11-25', 'Books from 25 Nov 2026 - Petty cash Sokhna',
   COALESCE((SELECT account_code FROM public.petty_cash_accounts WHERE location_key = 'sokhna' AND account_code IS NOT NULL LIMIT 1), '108000'), '302000');

INSERT INTO public.petty_cash_settings (location, opening_balance, updated_at)
VALUES ('north_coast', 0, now()), ('sokhna', 424, now())
ON CONFLICT (location) DO UPDATE SET opening_balance = EXCLUDED.opening_balance, updated_at = now();
UPDATE public.petty_cash_accounts SET opening_amount = CASE location_key WHEN 'sokhna' THEN 424 ELSE 0 END
WHERE location_key IN ('sokhna', 'north_coast');

SELECT id, entry_date, description, debit_account_code AS dr, credit_account_code AS cr, amount
FROM public.financial_manual_entries WHERE description LIKE 'Opening balance - %' ORDER BY id;
SELECT 'total' AS item, SUM(amount) AS amount FROM public.financial_manual_entries WHERE description LIKE 'Opening balance - %';
SELECT location_key, opening_amount FROM public.petty_cash_accounts ORDER BY id;
COMMIT;
