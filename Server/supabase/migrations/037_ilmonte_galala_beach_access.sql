-- 037: IL Monte Galala beach access — 750 EGP / 7 days, extra person 1000 EGP

UPDATE units
SET
  access_fee_per_adult_egp = 750,
  access_fee_per_teen_egp = 1000,
  access_card_count_included = 7,
  updated_at = NOW()
WHERE listing_type IS DISTINCT FROM 'sale'
  AND (
    LOWER(COALESCE(project, '')) ~ '(il[[:space:]]*)?monte[[:space:]]*galala|ilmonte[[:space:]]*galala'
    OR LOWER(COALESCE(compound, '')) ~ '(il[[:space:]]*)?monte[[:space:]]*galala|ilmonte[[:space:]]*galala'
  );
