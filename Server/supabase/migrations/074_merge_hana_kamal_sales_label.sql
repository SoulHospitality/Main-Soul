-- Hanna / Hana → canonical Hana Kamal on reservations.
UPDATE reservations
SET sales_label = 'Hana Kamal',
    updated_at = now()
WHERE lower(regexp_replace(btrim(sales_label), '\s+', ' ', 'g')) IN ('hanna', 'hana');
