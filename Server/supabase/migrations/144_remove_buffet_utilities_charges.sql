-- Staff buffet and campus utilities are no longer automatic monthly charges.
-- Their expense accounts (508000, 608000) stay for manual entries and fixed monthly charges.
DO $$
BEGIN
  IF to_regclass('public.financial_recurring_charges') IS NOT NULL THEN
    DELETE FROM public.financial_recurring_charges WHERE kind IN ('utilities', 'buffet');
  END IF;
END $$;
