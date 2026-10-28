-- Exact money, payment kind, idempotency, and the reservation payment index.
-- Percent columns stay as they are. A failed unique Paymob index is skipped when
-- duplicate references already exist, so boot can continue.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS kind varchar(20) NOT NULL DEFAULT 'collection';

ALTER TABLE public.payments
  DROP CONSTRAINT IF EXISTS payments_kind_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_kind_check
  CHECK (kind = ANY (ARRAY['collection', 'refund', 'forfeit']));

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx
  ON public.payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> '';

CREATE INDEX IF NOT EXISTS payments_reservation_id_idx
  ON public.payments (reservation_id);

CREATE INDEX IF NOT EXISTS payments_booking_id_idx
  ON public.payments (booking_id);

DO $$
DECLARE
  dup_count integer;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT payment_method, transaction_reference
    FROM public.payments
    WHERE transaction_reference IS NOT NULL AND btrim(transaction_reference) <> ''
    GROUP BY payment_method, transaction_reference
    HAVING COUNT(*) > 1
  ) d;
  IF dup_count = 0 THEN
    EXECUTE $idx$
      CREATE UNIQUE INDEX IF NOT EXISTS payments_method_reference_uidx
        ON public.payments (payment_method, transaction_reference)
        WHERE transaction_reference IS NOT NULL AND btrim(transaction_reference) <> ''
    $idx$;
  ELSE
    RAISE NOTICE 'Skipped payments reference unique index: % duplicate groups', dup_count;
  END IF;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND data_type IN ('real', 'double precision')
      AND column_name ~* 'exchange_rate'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(12,4) USING round(%I::numeric, 4)',
      r.table_name, r.column_name, r.column_name
    );
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('real', 'double precision')
      AND c.column_name !~* '(pct|percent|percentage|ratio|factor|rate|days|hours|count|nights)'
      AND c.column_name ~* '(amount|total|price|paid|fee|cost|salary|commission|balance|rent|deposit|insurance|utilities|bonus|deduction|payout|reward|gross|net)'
  LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I ALTER COLUMN %I TYPE numeric(14,2) USING round(%I::numeric, 2)',
        r.table_name, r.column_name, r.column_name
      );
    EXCEPTION WHEN OTHERS THEN
      IF r.table_name IN ('reservations', 'payments', 'expenses', 'staff_users') THEN
        RAISE;
      ELSE
        RAISE NOTICE 'money type skipped %.%: %', r.table_name, r.column_name, SQLERRM;
      END IF;
    END;
  END LOOP;
END $$;
