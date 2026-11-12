-- 1) Optional 15% service charge on manual reservations, billed on top of the stay like housekeeping.
--    service_fee_percent NULL = not chosen (older and website stays keep their own pricing).
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS service_fees numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_fee_percent numeric(5, 2);

-- Manual reservations that never had a service charge chosen: none applies.
UPDATE public.reservations
SET service_fee_percent = 0
WHERE service_fee_percent IS NULL
  AND booking_id IS NULL
  AND lower(COALESCE(booking_source, '')) NOT IN ('website', 'web');

-- 2) Reservation collection only checks the down payment of a manual reservation.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_down_payment boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.payments_flag_cash_review() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.finance_review_status IS NULL
     AND COALESCE(NEW.is_down_payment, false)
     AND NEW.reservation_id IS NOT NULL
     AND COALESCE(NEW.amount, 0) > 0
     AND lower(COALESCE(NEW.status, '')) NOT IN ('failed', 'cancelled')
     -- Recorded by finance or the CEO: nothing to check.
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_users s
       WHERE s.id = NEW.created_by
         AND s.role IN ('finance', 'finance_manager', 'admin')
     )
  THEN
    NEW.finance_review_status := 'pending';
  END IF;
  RETURN NEW;
END $$;

-- Anything waiting that is not a down payment (door collections, website payments…) leaves the list.
UPDATE public.payments
SET finance_review_status = NULL
WHERE finance_review_status = 'pending'
  AND NOT COALESCE(is_down_payment, false);
