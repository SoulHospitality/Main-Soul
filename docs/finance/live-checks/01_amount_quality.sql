-- Check 1: amount quality since the books start. Read-only. No personal data.
BEGIN TRANSACTION READ ONLY;

-- 1a. Row counts and totals per table since 2026-10-01.
SELECT 'payments' AS source, kind AS type, COUNT(*) AS rows, SUM(amount)::numeric(16,2) AS total
FROM public.payments WHERE payment_date >= DATE '2026-10-01' GROUP BY kind
UNION ALL
SELECT 'expenses', NULL, COUNT(*), SUM(amount)::numeric(16,2) FROM public.expenses WHERE COALESCE(expense_date, created_at::date) >= DATE '2026-10-01'
UNION ALL
SELECT 'reservations', status, COUNT(*), SUM(total_amount)::numeric(16,2) FROM public.reservations WHERE check_in >= DATE '2026-10-01' GROUP BY status
ORDER BY 1, 2;

-- 1b. Suspicious amounts (internal ids only).
SELECT 'payment' AS record, id, amount, kind, status
FROM public.payments
WHERE payment_date >= DATE '2026-10-01'
  AND (amount IS NULL OR amount = 0 OR (amount < 0 AND COALESCE(kind, 'collection') <> 'refund') OR amount > 1000000)
UNION ALL
SELECT 'expense', id, amount, NULL, NULL
FROM public.expenses
WHERE COALESCE(expense_date, created_at::date) >= DATE '2026-10-01' AND (amount IS NULL OR amount <= 0 OR amount > 1000000)
UNION ALL
SELECT 'reservation', id, total_amount, NULL, status
FROM public.reservations
WHERE check_in >= DATE '2026-10-01' AND status IN ('confirmed', 'checked_in', 'checked_out')
  AND (total_amount IS NULL OR total_amount <= 0 OR total_amount > 5000000)
ORDER BY 1, 2;

ROLLBACK;
