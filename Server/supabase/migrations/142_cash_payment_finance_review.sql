-- Every collected cash payment on a reservation waits for finance (finance agent or finance manager) to check
-- its amount and payment method. Payments recorded or approved by finance itself need no review.
-- Only payments collected from now on are flagged; older ones keep finance_review_status NULL.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS finance_review_status varchar(12),
  ADD COLUMN IF NOT EXISTS finance_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finance_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS finance_review_note text,
  ADD COLUMN IF NOT EXISTS finance_review_original jsonb;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_finance_review_status_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_finance_review_status_check
  CHECK (finance_review_status IS NULL OR finance_review_status IN ('pending', 'reviewed'));

CREATE INDEX IF NOT EXISTS payments_finance_review_pending_idx
  ON public.payments (created_at)
  WHERE finance_review_status = 'pending';

CREATE OR REPLACE FUNCTION public.payments_flag_cash_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.finance_review_status IS NULL
     AND NEW.reservation_id IS NOT NULL
     AND lower(COALESCE(NEW.payment_method, '')) = 'cash'
     AND COALESCE(NEW.amount, 0) > 0
     AND COALESCE(NEW.kind, 'collection') = 'collection'
     AND lower(COALESCE(NEW.status, '')) NOT IN ('failed', 'cancelled')
     AND (COALESCE(NEW.is_approved, 0) = 1 OR lower(COALESCE(NEW.status, '')) IN ('successful', 'paid', 'completed'))
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_users s
       WHERE s.id = COALESCE(NEW.approved_by, NEW.created_by)
         AND s.role IN ('finance', 'finance_manager')
     )
  THEN
    NEW.finance_review_status := 'pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_flag_cash_review ON public.payments;
CREATE TRIGGER payments_flag_cash_review
  BEFORE INSERT OR UPDATE OF status, is_approved, payment_method, amount ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.payments_flag_cash_review();
