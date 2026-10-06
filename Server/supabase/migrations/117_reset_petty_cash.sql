-- Petty cash restarts from zero with the Financial System reset (books_reset_at).
-- Entries created before the reset are kept but no longer listed or counted.

DO $$
BEGIN
  IF to_regclass('public.petty_cash_settings') IS NOT NULL THEN
    UPDATE public.petty_cash_settings SET opening_balance = 0, updated_at = now();
  END IF;
END $$;

INSERT INTO public.financial_settings (key, value_text, updated_at)
VALUES ('books_reset_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
ON CONFLICT (key) DO NOTHING;
