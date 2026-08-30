-- Nabarawy / Nabrawy / Abdullah Nabarawy → canonical Abdullah Al Nabarawi.
UPDATE reservations
SET sales_label = 'Abdullah Al Nabarawi',
    updated_at = now()
WHERE lower(regexp_replace(btrim(sales_label), '\s+', ' ', 'g')) IN (
  'abdullah nabarawy',
  'abdullah nabrawy',
  'nabrawy',
  'nabarawy'
);
