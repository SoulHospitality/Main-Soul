-- Replace the operating expense accounts with the campus chart.
-- 503000 (villa repairs) is retired; its journals move to 605000 General & Administrations Expenses.
-- User-added expense sub-accounts are removed. Calculated accounts stay: 504000, 506000, 609000.

DO $$
BEGIN
  IF to_regclass('public.financial_custom_accounts') IS NOT NULL THEN
    CREATE TEMP TABLE retired_expense_codes ON COMMIT DROP AS
    SELECT code
    FROM public.financial_custom_accounts
    WHERE account_group = 'expenses'
       OR parent_code IN (
         '501000', '503000', '504000', '506000', '508000',
         '601000', '602000', '603000', '604000', '605000', '608000', '609000'
       );

    IF to_regclass('public.financial_manual_entries') IS NOT NULL THEN
      UPDATE public.financial_manual_entries
      SET debit_account_code = '605000'
      WHERE debit_account_code = '503000'
         OR debit_account_code IN (SELECT code FROM retired_expense_codes);
      UPDATE public.financial_manual_entries
      SET credit_account_code = '605000'
      WHERE credit_account_code = '503000'
         OR credit_account_code IN (SELECT code FROM retired_expense_codes);
    END IF;

    DELETE FROM public.financial_custom_accounts
    WHERE code IN (SELECT code FROM retired_expense_codes);
  ELSIF to_regclass('public.financial_manual_entries') IS NOT NULL THEN
    UPDATE public.financial_manual_entries
    SET debit_account_code = '605000'
    WHERE debit_account_code = '503000';
    UPDATE public.financial_manual_entries
    SET credit_account_code = '605000'
    WHERE credit_account_code = '503000';
  END IF;

  IF to_regclass('public.finance_calendar_payments') IS NOT NULL THEN
    UPDATE public.finance_calendar_payments
    SET account_code = '605000'
    WHERE account_code = '503000';
  END IF;

  IF to_regclass('public.financial_recurring_charges') IS NOT NULL THEN
    UPDATE public.financial_recurring_charges
    SET label = CASE kind
          WHEN 'rent' THEN 'Office Rent'
          WHEN 'utilities' THEN 'Campus Utilities'
          WHEN 'buffet' THEN 'Staff Buffet & Meals'
          ELSE label
        END,
        updated_at = now()
    WHERE kind IN ('rent', 'utilities', 'buffet');
  END IF;
END $$;
