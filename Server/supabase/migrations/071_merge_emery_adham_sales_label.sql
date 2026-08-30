-- Emry / Emery spellings → canonical Emery Adham on reservations.
UPDATE reservations
SET sales_label = 'Emery Adham',
    updated_at = now()
WHERE lower(regexp_replace(btrim(sales_label), '\s+', ' ', 'g')) IN ('emry', 'emery', 'emry adham');
