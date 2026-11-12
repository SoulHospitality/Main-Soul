-- Removes the test reservations created on 11 Nov 2026 (Cairo) under the guest names "Test", "test cash"
-- and "TETST", with everything attached to them: payments, refund requests, door-cash drawer entries,
-- housekeeping tasks, comments, notifications, history and the calendar nights they blocked.
-- They predate the books restart (migration 162), so no Financial System figure changes.
-- Safety: if the names match more than 20 reservations, nothing is deleted.

DO $$
DECLARE
  res_ids integer[];
  pay_ids integer[];
  booking_ids uuid[];
  fk record;
BEGIN
  BEGIN
  SELECT array_agg(id) INTO res_ids
  FROM public.reservations
  WHERE lower(btrim(COALESCE(guest_name, ''))) IN ('test', 'test cash', 'tetst')
    AND (created_at AT TIME ZONE 'Africa/Cairo')::date = DATE '2026-11-11';

  IF res_ids IS NULL THEN
    RAISE NOTICE 'No test reservations found';
    RETURN;
  END IF;
  IF array_length(res_ids, 1) > 20 THEN
    RAISE NOTICE 'Matched % reservations: more than expected, nothing deleted', array_length(res_ids, 1);
    RETURN;
  END IF;
  RAISE NOTICE 'Deleting test reservations %', res_ids;

  SELECT array_agg(DISTINCT booking_id) INTO booking_ids
  FROM public.reservations WHERE id = ANY(res_ids) AND booking_id IS NOT NULL;

  SELECT array_agg(id) INTO pay_ids
  FROM public.payments
  WHERE reservation_id = ANY(res_ids)
     OR (booking_ids IS NOT NULL AND booking_id = ANY(booking_ids));

  -- Calendar nights these stays blocked (kept only where no other active stay covers the night).
  CREATE TEMP TABLE _test_stays ON COMMIT DROP AS
  SELECT u.wp_post_id, r.check_in, r.check_out
  FROM public.reservations r JOIN public.units u ON u.id = r.unit_id
  WHERE r.id = ANY(res_ids) AND u.wp_post_id IS NOT NULL;

  -- Rows that point at the payments.
  IF pay_ids IS NOT NULL THEN
    FOR fk IN
      SELECT c.conrelid::regclass AS tbl, a.attname AS col, c.confdeltype AS action
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.confrelid = 'public.payments'::regclass AND array_length(c.conkey, 1) = 1
    LOOP
      IF fk.action = 'n' THEN
        EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = ANY($1)', fk.tbl, fk.col, fk.col) USING pay_ids;
      ELSE
        EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', fk.tbl, fk.col) USING pay_ids;
      END IF;
    END LOOP;
    IF to_regclass('public.petty_cash') IS NOT NULL THEN
      DELETE FROM public.petty_cash
      WHERE source = 'ops_collection' AND source_ref = ANY(SELECT unnest(pay_ids)::text);
    END IF;
  END IF;

  -- Rows that belong only to these stays.
  IF to_regclass('public.housekeeping_tasks') IS NOT NULL THEN
    DELETE FROM public.housekeeping_tasks WHERE reservation_id = ANY(res_ids);
  END IF;
  IF to_regclass('public.petty_cash') IS NOT NULL THEN
    DELETE FROM public.petty_cash WHERE linked_reservation_id = ANY(res_ids);
  END IF;
  DELETE FROM public.notifications WHERE entity_type = 'reservation' AND entity_id = ANY(res_ids);
  DELETE FROM public.audit_log
  WHERE reservation_id = ANY(res_ids)
     OR (entity_type = 'reservation' AND entity_id = ANY(SELECT unnest(res_ids)::text))
     OR (pay_ids IS NOT NULL AND entity_type = 'payment' AND entity_id = ANY(SELECT unnest(pay_ids)::text));

  -- Every other table pointing at these reservations: clear links that may outlive them, delete the rest.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, a.attname AS col, c.confdeltype AS action
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.confrelid = 'public.reservations'::regclass AND array_length(c.conkey, 1) = 1
      AND c.conrelid <> 'public.payments'::regclass
  LOOP
    IF fk.action = 'n' THEN
      EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = ANY($1)', fk.tbl, fk.col, fk.col) USING res_ids;
    ELSIF fk.action <> 'c' THEN
      EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', fk.tbl, fk.col) USING res_ids;
    END IF;
  END LOOP;

  IF pay_ids IS NOT NULL THEN
    DELETE FROM public.payments WHERE id = ANY(pay_ids);
  END IF;
  DELETE FROM public.reservations WHERE id = ANY(res_ids);
  IF booking_ids IS NOT NULL THEN
    DELETE FROM public.payments WHERE booking_id = ANY(booking_ids);
    DELETE FROM public.bookings WHERE id = ANY(booking_ids);
  END IF;

  -- Free the calendar nights.
  DELETE FROM public.unit_blocked_dates b
  USING _test_stays s
  WHERE b.wp_post_id = s.wp_post_id
    AND b.date >= s.check_in AND b.date < s.check_out
    AND COALESCE(b.source, '') IN ('reservation', 'reservation_import', 'booking')
    AND NOT EXISTS (
      SELECT 1 FROM public.reservations r JOIN public.units u ON u.id = r.unit_id
      WHERE u.wp_post_id = b.wp_post_id AND r.status IS DISTINCT FROM 'cancelled'
        AND b.date >= r.check_in AND b.date < r.check_out
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block a deploy: on any surprise nothing is deleted and the reason is logged.
    RAISE WARNING 'Test reservations not deleted: %', SQLERRM;
  END;
END $$;
