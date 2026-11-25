-- Check 2: USD reservations and their exchange rates. Read-only. No personal data.
BEGIN TRANSACTION READ ONLY;

-- 2a. USD reservations without a usable rate (these block migration of that reservation).
SELECT id AS reservation_id, status, check_in, total_amount, exchange_rate
FROM public.reservations
WHERE upper(COALESCE(currency, 'EGP')) = 'USD'
  AND (exchange_rate IS NULL OR exchange_rate <= 0)
ORDER BY check_in;

-- 2b. Spread of rates used per month (sanity check against the market rate of that month).
SELECT to_char(check_in, 'YYYY-MM') AS month, COUNT(*) AS usd_reservations,
       MIN(exchange_rate) AS min_rate, MAX(exchange_rate) AS max_rate, ROUND(AVG(exchange_rate)::numeric, 4) AS avg_rate
FROM public.reservations
WHERE upper(COALESCE(currency, 'EGP')) = 'USD' AND exchange_rate > 0
GROUP BY 1 ORDER BY 1;

-- 2c. Currencies in use.
SELECT upper(COALESCE(currency, 'EGP')) AS currency, COUNT(*) AS reservations
FROM public.reservations GROUP BY 1 ORDER BY 2 DESC;

ROLLBACK;
