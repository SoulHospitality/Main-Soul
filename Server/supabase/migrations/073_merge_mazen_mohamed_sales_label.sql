-- Mazen → canonical Mazen Mohamed on reservations.
UPDATE reservations
SET sales_label = 'Mazen Mohamed',
    updated_at = now()
WHERE lower(regexp_replace(btrim(sales_label), '\s+', ' ', 'g')) = 'mazen';
