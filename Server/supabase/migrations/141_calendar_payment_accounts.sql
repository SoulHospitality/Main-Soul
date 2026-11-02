-- Manual calendar payments name the treasury account the money leaves or lands in (account_code stays the
-- other side), can repeat monthly as a series, and post a journal once confirmed as paid.

ALTER TABLE public.finance_calendar_payments
  ADD COLUMN IF NOT EXISTS treasury_account_code varchar(16),
  ADD COLUMN IF NOT EXISTS series_id varchar(40),
  ADD COLUMN IF NOT EXISTS series_index integer,
  ADD COLUMN IF NOT EXISTS series_count integer,
  ADD COLUMN IF NOT EXISTS paid_date date,
  ADD COLUMN IF NOT EXISTS journal_entry_id integer;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance_calendar_payments_journal_fk') THEN
    ALTER TABLE public.finance_calendar_payments
      ADD CONSTRAINT finance_calendar_payments_journal_fk
      FOREIGN KEY (journal_entry_id) REFERENCES public.financial_manual_entries(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS finance_calendar_payments_series_idx
  ON public.finance_calendar_payments (series_id);
