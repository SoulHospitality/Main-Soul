-- Check 4: legacy cash_ledger next to the cash the books see, by month. Read-only. No personal data.
-- The books' cash accounts are computed by the application; compare this output with the
-- Financial System → Accounts tool (accounts 103000 / 104000 / 108000) for the same months.
BEGIN TRANSACTION READ ONLY;

WITH legacy AS (
  SELECT to_char(entry_date, 'YYYY-MM') AS month,
         SUM(CASE WHEN entry_type = 'in' THEN amount ELSE 0 END)::numeric(16,2) AS cash_ledger_in,
         SUM(CASE WHEN entry_type = 'out' THEN amount ELSE 0 END)::numeric(16,2) AS cash_ledger_out
  FROM public.cash_ledger GROUP BY 1
),
pay AS (
  SELECT to_char(payment_date, 'YYYY-MM') AS month,
         SUM(CASE WHEN COALESCE(kind, 'collection') = 'collection' THEN amount ELSE 0 END)::numeric(16,2) AS cash_payments_in,
         SUM(CASE WHEN kind = 'refund' THEN abs(amount) ELSE 0 END)::numeric(16,2) AS cash_refunds_out
  FROM public.payments
  WHERE lower(payment_method) = 'cash' AND COALESCE(status, 'successful') = 'successful'
  GROUP BY 1
)
SELECT COALESCE(l.month, p.month) AS month,
       l.cash_ledger_in, l.cash_ledger_out,
       p.cash_payments_in, p.cash_refunds_out
FROM legacy l FULL OUTER JOIN pay p ON p.month = l.month
ORDER BY 1;

ROLLBACK;
