-- Reservation collection: every payment collected on a reservation (any method, not only cash) waits for
-- finance to check its payment method and amount. Payments recorded or approved by finance need no check.
CREATE OR REPLACE FUNCTION public.payments_flag_cash_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.finance_review_status IS NULL
     AND NEW.reservation_id IS NOT NULL
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

-- Payments of the last 30 days that were never checked join the list.
UPDATE public.payments p
SET finance_review_status = 'pending'
WHERE p.finance_review_status IS NULL
  AND p.reservation_id IS NOT NULL
  AND COALESCE(p.amount, 0) > 0
  AND COALESCE(p.kind, 'collection') = 'collection'
  AND lower(COALESCE(p.status, '')) NOT IN ('failed', 'cancelled')
  AND (COALESCE(p.is_approved, 0) = 1 OR lower(COALESCE(p.status, '')) IN ('successful', 'paid', 'completed'))
  AND p.created_at >= now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.staff_users s
    WHERE s.id = COALESCE(p.approved_by, p.created_by) AND s.role IN ('finance', 'finance_manager')
  );
