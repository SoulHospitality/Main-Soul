-- Nouran → canonical Nouran Nasser on reservations.
UPDATE reservations
SET sales_label = 'Nouran Nasser',
    updated_at = now()
WHERE lower(regexp_replace(btrim(sales_label), '\s+', ' ', 'g')) = 'nouran';
