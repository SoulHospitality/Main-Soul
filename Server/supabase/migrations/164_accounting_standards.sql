-- Accounting standards pass:
--  * "Paid from" treasury on expenses, owner payouts and vendor bills (books no longer assume ADIB).
--  * Tax mode on expenses (automatic VAT / WHT, or none for receipts without tax).
--  * Written-off amount on reservations so Outstanding and the books drop approved write-offs.
--  * Frozen journals for closed months, and the corrections that later changes post to the open month.
--  * Missing down payments recorded as payments (they dropped out of "paid" once another payment existed).
--  * "Awaiting collection" placeholder payments cancelled: Outstanding already works out what is due.

ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS paid_from_account text;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'auto';
ALTER TABLE public.owner_payout_requests ADD COLUMN IF NOT EXISTS paid_from_account text;
ALTER TABLE public.vendor_invoices ADD COLUMN IF NOT EXISTS paid_from_account text;
ALTER TABLE public.vendor_invoices ADD COLUMN IF NOT EXISTS expense_account text;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS written_off_amount numeric(12,2) NOT NULL DEFAULT 0;

-- Petty cash moved to expenses left the drawer, not the bank, and carries no automatic tax.
UPDATE public.expenses e
SET paid_from_account = COALESCE(pa.account_code, '108000'), tax_mode = 'none'
FROM public.petty_cash pc
LEFT JOIN public.petty_cash_accounts pa ON pa.location_key = pc.location
WHERE pc.linked_expense_id = e.id AND e.paid_from_account IS NULL;

UPDATE public.reservations r
SET written_off_amount = w.total
FROM (
  SELECT reservation_id, SUM(amount)::numeric(12,2) AS total
  FROM public.ar_write_offs WHERE status = 'approved' GROUP BY reservation_id
) w
WHERE w.reservation_id = r.id;

CREATE TABLE IF NOT EXISTS public.financial_posted_entries (
  id serial PRIMARY KEY,
  year_month text NOT NULL,          -- closed month the row belongs to (frozen) or corrects (adjustment)
  kind text NOT NULL CHECK (kind IN ('frozen', 'adjustment')),
  entry_id text NOT NULL,
  entry_date date NOT NULL,
  entry jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_posted_entries_month_idx ON public.financial_posted_entries (year_month, kind);
CREATE INDEX IF NOT EXISTS financial_posted_entries_date_idx ON public.financial_posted_entries (entry_date);

-- Down payments that dropped out of "paid": record each as the payment it was.
-- Skipped when a payment of the same amount was already recorded around the booking date.
WITH dropped AS (
  SELECT r.*
  FROM public.reservations r
  WHERE COALESCE(r.down_payment, 0) > 0
    AND r.status::text <> 'cancelled'
    AND r.booking_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p WHERE p.reservation_id = r.id
        AND (COALESCE(p.is_down_payment, false) OR p.notes = 'Down payment (manual reservation)')
    )
    AND EXISTS (
      SELECT 1 FROM public.payments p WHERE p.reservation_id = r.id
        AND p.status = 'successful' AND COALESCE(p.is_approved, 0) = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.payments p WHERE p.reservation_id = r.id
        AND p.status = 'successful' AND COALESCE(p.is_approved, 0) = 1
        AND abs(p.amount - r.down_payment) < 0.01
        AND p.created_at < r.created_at + interval '1 day'
    )
)
INSERT INTO public.payments (
  reservation_id, amount, payment_date, payment_method, notes, created_by, status,
  is_approved, approved_at, paid_at, bank_account, is_down_payment, finance_review_status, created_at
)
SELECT d.id, d.down_payment, d.created_at::date,
       COALESCE(NULLIF(d.payment_method::text, ''), 'cash'),
       'Down payment (manual reservation)', d.created_by, 'successful',
       1, d.created_at, d.created_at, d.bank_account, true, 'reviewed', d.created_at
FROM dropped d;

-- Recompute "paid" from payment rows for every stay with a recorded down payment.
UPDATE public.reservations r
SET amount_paid = s.paid
FROM (
  SELECT p.reservation_id,
         GREATEST(COALESCE(SUM(p.amount) FILTER (WHERE COALESCE(p.kind, 'collection') <> 'forfeit'), 0), 0) AS paid
  FROM public.payments p
  WHERE p.status = 'successful' AND COALESCE(p.is_approved, 0) = 1
    AND p.reservation_id IN (
      SELECT reservation_id FROM public.payments
      WHERE notes = 'Down payment (manual reservation)' AND finance_review_status = 'reviewed'
        AND created_at = (SELECT created_at FROM public.reservations WHERE id = reservation_id)
    )
  GROUP BY p.reservation_id
) s
WHERE s.reservation_id = r.id;

UPDATE public.payments
SET status = 'cancelled'
WHERE status = 'pending'
  AND notes LIKE 'Awaiting collection (manual reservation)%';
