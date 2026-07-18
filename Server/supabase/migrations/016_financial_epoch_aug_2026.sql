-- Financial books open 2026-08-01.
-- Remove payments, expenses, and cash movements before that date (incl. July 2026).

DELETE FROM payments
WHERE COALESCE(payment_date, created_at::date) < DATE '2026-08-01';

DELETE FROM expenses
WHERE COALESCE(expense_date, created_at::date) < DATE '2026-08-01';

DELETE FROM petty_cash
WHERE COALESCE(entry_date, created_at::date) < DATE '2026-08-01';

DELETE FROM cash_ledger
WHERE COALESCE(entry_date, created_at::date) < DATE '2026-08-01';

-- Recompute reservation amount_paid from remaining payment rows
UPDATE reservations r
SET amount_paid = COALESCE((
  SELECT SUM(p.amount)::numeric
  FROM payments p
  WHERE p.reservation_id = r.id
    AND COALESCE(p.status, 'successful') NOT IN ('failed', 'cancelled')
), 0);

UPDATE reservations
SET payment_status = CASE
  WHEN COALESCE(amount_paid, 0) <= 0 THEN 'unpaid'
  WHEN COALESCE(amount_paid, 0) >= COALESCE(total_amount, 0) AND COALESCE(total_amount, 0) > 0 THEN 'paid'
  ELSE 'partial'
END
WHERE status <> 'cancelled';
