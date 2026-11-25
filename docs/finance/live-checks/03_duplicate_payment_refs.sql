-- Check 3: payments sharing a method + transaction reference. Read-only. No personal data.
BEGIN TRANSACTION READ ONLY;

-- 3a. Does the unique index from migration 139 exist? (It was skipped if duplicates existed then.)
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'payments' AND indexname = 'payments_method_reference_uidx';

-- 3b. Duplicate groups (references shortened to their last 4 characters).
SELECT payment_method,
       '…' || right(transaction_reference, 4) AS reference_tail,
       COUNT(*) AS payments,
       SUM(amount)::numeric(16,2) AS total,
       array_agg(id ORDER BY id) AS payment_ids,
       array_agg(DISTINCT reservation_id) AS reservation_ids
FROM public.payments
WHERE transaction_reference IS NOT NULL AND btrim(transaction_reference) <> ''
GROUP BY payment_method, transaction_reference
HAVING COUNT(*) > 1
ORDER BY payments DESC, total DESC;

ROLLBACK;
