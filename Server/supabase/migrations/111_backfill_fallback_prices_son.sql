-- Fill missing Sep / Oct / Nov daily prices from each rental unit's price_fallback.
-- Does not overwrite existing prices > 0.

WITH bounds AS (
  SELECT
    make_date(
      EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo'))::int,
      9,
      1
    ) AS d_from,
    make_date(
      EXTRACT(YEAR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Cairo'))::int,
      11,
      30
    ) AS d_to
)
INSERT INTO public.unit_daily_prices (wp_post_id, date, price, currency, source, updated_at)
SELECT
  u.wp_post_id,
  d::date,
  ROUND(u.price_fallback)::int,
  COALESCE(NULLIF(u.price_currency, ''), 'EGP'),
  'fallback-backfill-son',
  now()
FROM public.units u
CROSS JOIN bounds b
CROSS JOIN LATERAL generate_series(b.d_from, b.d_to, '1 day'::interval) AS d
WHERE u.wp_post_id IS NOT NULL
  AND COALESCE(u.listing_type, 'rent') = 'rent'
  AND COALESCE(u.status, 'draft') NOT IN ('archived', 'cancelled', 'delisted')
  AND COALESCE(u.price_fallback, 0) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.unit_daily_prices p
    WHERE p.wp_post_id = u.wp_post_id
      AND p.date = d::date
      AND COALESCE(p.price, 0) > 0
  )
ON CONFLICT (wp_post_id, date) DO UPDATE SET
  price = EXCLUDED.price,
  source = EXCLUDED.source,
  updated_at = now()
WHERE COALESCE(public.unit_daily_prices.price, 0) <= 0;
