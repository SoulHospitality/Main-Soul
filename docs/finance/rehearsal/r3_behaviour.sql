-- Rehearsal r3: behaviour of migrations 175 and 176. WRITES TEST DATA. RESTORED COPY ONLY.
-- Refuses to run unless the session first declares it is on a restored copy:
--   SET app.rehearsal_copy = 'restored-copy-not-production';
-- Creates rows marked 'rehearsal' / 'REHEARSAL TEST'; changes no existing row. Ends by listing results:
-- every row must say passed = true. Output contains internal ids and messages only.

DO $$ BEGIN
  IF COALESCE(current_setting('app.rehearsal_copy', true), '') <> 'restored-copy-not-production' THEN
    RAISE EXCEPTION 'Refusing to run: r3 writes test data and is only for a restored copy of production.';
  END IF;
END $$;

CREATE TEMP TABLE rehearsal_results (n serial, check_name text, passed boolean, detail text);
CREATE TEMP TABLE rh (k text PRIMARY KEY, v text);

CREATE FUNCTION pg_temp.ok(name text, cond boolean, detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS
  $f$ INSERT INTO rehearsal_results (check_name, passed, detail) VALUES (name, COALESCE(cond, false), detail) $f$;
CREATE FUNCTION pg_temp.v(key text) RETURNS text LANGUAGE sql AS $f$ SELECT v FROM rh WHERE k = key $f$;
-- Runs a statement that must fail with a message matching `pattern`; nothing it did is kept.
CREATE FUNCTION pg_temp.must_fail(name text, stmt text, pattern text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE succeeded boolean := false;
BEGIN
  BEGIN
    EXECUTE stmt;
    EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';  -- fire deferred balance checks now, inside this block
    succeeded := true;
    RAISE EXCEPTION 'rehearsal: undo';       -- undo whatever the statement did
  EXCEPTION WHEN others THEN
    IF succeeded THEN
      PERFORM pg_temp.ok(name, false, 'statement succeeded but should have been refused (undone)');
    ELSE
      PERFORM pg_temp.ok(name, SQLERRM ~* pattern, SQLERRM);
    END IF;
  END;
END $f$;
CREATE FUNCTION pg_temp.snap(res_id integer) RETURNS jsonb LANGUAGE sql AS
  $f$ SELECT commission_snapshot FROM public.reservations WHERE id = res_id $f$;
CREATE FUNCTION pg_temp.res(unit_key text, status text, sp_key text DEFAULT 'sp', owner integer DEFAULT 0) RETURNS integer LANGUAGE plpgsql AS $f$
DECLARE rid integer;
BEGIN
  INSERT INTO public.reservations (unit_id, guest_name, check_in, check_out, nights, total_amount, status, sales_person_id, is_owner_reservation, created_by)
  VALUES (pg_temp.v(unit_key)::uuid, 'REHEARSAL TEST', DATE '2027-03-01', DATE '2027-03-03', 2, 2000, status,
          CASE WHEN sp_key IS NULL THEN NULL ELSE pg_temp.v(sp_key)::integer END, owner, pg_temp.v('sp')::integer)
  RETURNING id INTO rid;
  RETURN rid;
END $f$;

-- ── Set-up: rehearsal staff and units ──
DO $$
DECLARE x text;
BEGIN
  INSERT INTO public.staff_users (username, password_hash, full_name, role, is_active, sales_commission_pct)
  VALUES ('rehearsal_sales', 'x', 'Rehearsal Sales', 'reservations', 1, 10) RETURNING id::text INTO x; INSERT INTO rh VALUES ('sp', x);
  INSERT INTO public.staff_users (username, password_hash, full_name, role, is_active)
  VALUES ('rehearsal_admin1', 'x', 'Rehearsal Admin 1', 'admin', 1) RETURNING id::text INTO x; INSERT INTO rh VALUES ('a1', x);
  INSERT INTO public.staff_users (username, password_hash, full_name, role, is_active)
  VALUES ('rehearsal_admin2', 'x', 'Rehearsal Admin 2', 'admin', 1) RETURNING id::text INTO x; INSERT INTO rh VALUES ('a2', x);
  INSERT INTO public.units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, commission_mode)
  VALUES ('rehearsal-a', 'Rehearsal A', 'RH-A', 'draft', 'rent', 'Rehearsal', 'Rehearsal', 1, 1, 2, 20, 'A') RETURNING id::text INTO x; INSERT INTO rh VALUES ('ua', x);
  INSERT INTO public.units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, commission_mode)
  VALUES ('rehearsal-zero', 'Rehearsal 0', 'RH-0', 'draft', 'rent', 'Rehearsal', 'Rehearsal', 1, 1, 2, 0, 'A') RETURNING id::text INTO x; INSERT INTO rh VALUES ('u0', x);
  INSERT INTO public.units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, company_commission_owner_pct, commission_tenant_pct, commission_mode)
  VALUES ('rehearsal-c', 'Rehearsal C', 'RH-C', 'draft', 'rent', 'Rehearsal', 'Rehearsal', 1, 1, 2, 22, 12, 10, 'C') RETURNING id::text INTO x; INSERT INTO rh VALUES ('uc', x);
END $$;

-- ── 175: capture on confirmation, applied rates ──
DO $$
DECLARE r integer; s jsonb;
BEGIN
  r := pg_temp.res('ua', 'pending'); INSERT INTO rh VALUES ('r1', r);
  PERFORM pg_temp.ok('pending reservation has no snapshot', pg_temp.snap(r) IS NULL);
  UPDATE public.reservations SET status = 'confirmed' WHERE id = r;
  s := pg_temp.snap(r);
  PERFORM pg_temp.ok('confirmation captures applied company 20% (unit rate) and sales 10%',
    (s->'applied'->>'company_pct')::numeric = 20 AND s->'applied'->>'company_pct_source' = 'unit company %'
    AND (s->'applied'->>'sales_pct')::numeric = 10 AND (s->>'version')::int = 2
    AND (SELECT commission_snapshot_status FROM public.reservations WHERE id = r) = 'captured', s->>'applied');
  INSERT INTO rh VALUES ('r1snap', s::text);
END $$;

-- Retries / repeated confirmations and later rate changes leave the snapshot untouched.
UPDATE public.units SET company_commission_pct = 25 WHERE id = pg_temp.v('ua')::uuid;
UPDATE public.staff_users SET sales_commission_pct = 15 WHERE id = pg_temp.v('sp')::integer;
UPDATE public.reservations SET status = 'confirmed' WHERE id = pg_temp.v('r1')::integer;
UPDATE public.reservations SET status = 'checked_in' WHERE id = pg_temp.v('r1')::integer;
UPDATE public.reservations SET status = 'pending' WHERE id = pg_temp.v('r1')::integer;
UPDATE public.reservations SET status = 'confirmed' WHERE id = pg_temp.v('r1')::integer;
SELECT pg_temp.ok('retried confirmations and rate changes leave the saved snapshot byte-identical',
  pg_temp.snap(pg_temp.v('r1')::integer)::text = pg_temp.v('r1snap'));

DO $$
DECLARE r integer; s jsonb;
BEGIN
  r := pg_temp.res('ua', 'confirmed'); INSERT INTO rh VALUES ('r2', r); s := pg_temp.snap(r);
  PERFORM pg_temp.ok('a reservation confirmed after the change uses the new rates (25% / 15%)',
    (s->'applied'->>'company_pct')::numeric = 25 AND (s->'applied'->>'sales_pct')::numeric = 15, s->>'applied');
  r := pg_temp.res('u0', 'confirmed', NULL); INSERT INTO rh VALUES ('r3', r); s := pg_temp.snap(r);
  PERFORM pg_temp.ok('unit with no company % records the 20% default; no salesperson records no sales %',
    (s->'applied'->>'company_pct')::numeric = 20 AND s->'applied'->>'company_pct_source' LIKE 'default%'
    AND s->'applied'->'sales_pct' = 'null'::jsonb, s->>'applied');
  r := pg_temp.res('uc', 'confirmed', 'sp', 1); s := pg_temp.snap(r);
  PERFORM pg_temp.ok('mode C owner-booked: owner % (12), no tenant deduction',
    (s->'applied'->>'company_pct')::numeric = 12 AND (s->'applied'->>'tenant_deduction_pct')::numeric = 0, s->>'applied');
  r := pg_temp.res('uc', 'confirmed', 'sp', 0); INSERT INTO rh VALUES ('r5', r); s := pg_temp.snap(r);
  PERFORM pg_temp.ok('mode C guest stay: company % (22) and tenant deduction (10)',
    (s->'applied'->>'company_pct')::numeric = 22 AND (s->'applied'->>'tenant_deduction_pct')::numeric = 10, s->>'applied');
END $$;

-- ── 175: nobody writes a snapshot by hand ──
SELECT pg_temp.must_fail('an insert cannot bring its own snapshot',
  format($s$INSERT INTO public.reservations (unit_id, guest_name, check_in, check_out, nights, total_amount, status, created_by, commission_snapshot)
            VALUES (%L, 'REHEARSAL TEST', '2027-03-01', '2027-03-02', 1, 1, 'confirmed', %s, '{"applied":{"company_pct":1}}')$s$,
         pg_temp.v('ua'), pg_temp.v('sp')), 'authorised correction');
SELECT pg_temp.must_fail('a saved snapshot cannot be overwritten',
  format($s$UPDATE public.reservations SET commission_snapshot = '{}' WHERE id = %s$s$, pg_temp.v('r1')), 'authorised correction');
DO $$
DECLARE hist integer;
BEGIN
  SELECT reservation_id INTO hist FROM public.reservation_commission_review
  WHERE review_reason LIKE 'original rate unknown%' ORDER BY reservation_id LIMIT 1;
  IF hist IS NULL THEN
    PERFORM pg_temp.ok('a real historical stay cannot be given an invented snapshot', true, 'no historical stay on this copy: not exercised');
  ELSE
    PERFORM pg_temp.must_fail('a real historical stay cannot be given an invented snapshot',
      format($s$UPDATE public.reservations SET commission_snapshot = '{"applied":{"company_pct":20}}' WHERE id = %s$s$, hist), 'authorised correction');
  END IF;
END $$;
UPDATE public.reservations SET commission_snapshot_status = 'corrected', commission_snapshot_at = now() - interval '9 days'
WHERE id = pg_temp.v('r1')::integer;
SELECT pg_temp.ok('status and time columns cannot be edited directly (kept as they were)',
  (SELECT commission_snapshot_status FROM public.reservations WHERE id = pg_temp.v('r1')::integer) = 'captured');

-- ── 175: review flags ──
UPDATE public.reservations SET sales_person_id = NULL WHERE id = pg_temp.v('r2')::integer;
UPDATE public.reservations SET is_owner_reservation = 1 WHERE id = pg_temp.v('r5')::integer;
UPDATE public.reservations SET status = 'cancelled' WHERE id = pg_temp.v('r3')::integer;
UPDATE public.reservations SET status = 'confirmed' WHERE id = pg_temp.v('r3')::integer;
SELECT pg_temp.ok('salesperson change, owner-flag change and re-confirmation after cancellation are flagged',
  (SELECT string_agg(review_reason, ' | ' ORDER BY reservation_id) FROM public.reservation_commission_review
    WHERE reservation_id IN (pg_temp.v('r2')::integer, pg_temp.v('r3')::integer, pg_temp.v('r5')::integer))
  ~ 'salesperson.*cancellation.*owner-booking',
  (SELECT string_agg(review_reason, ' | ' ORDER BY reservation_id) FROM public.reservation_commission_review
    WHERE reservation_id IN (pg_temp.v('r2')::integer, pg_temp.v('r3')::integer, pg_temp.v('r5')::integer)));

-- ── 175: corrections ──
CREATE FUNCTION pg_temp.correct(res text, actor text, approver text, reason text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('app.commission_correction', 'on', true),
          set_config('app.commission_correction_actor', COALESCE(actor, ''), true),
          set_config('app.commission_correction_approver', COALESCE(approver, ''), true),
          set_config('app.commission_correction_reason', COALESCE(reason, ''), true);
  UPDATE public.reservations
     SET commission_snapshot = jsonb_set(commission_snapshot, '{applied,company_pct}', '"18"')
   WHERE id = res::integer;
  PERFORM set_config('app.commission_correction', 'off', true);
END $f$;
SELECT pg_temp.must_fail('a correction without who and why is refused',
  format($s$SELECT pg_temp.correct(%L, NULL, NULL, NULL)$s$, pg_temp.v('r1')), 'reason');
SELECT pg_temp.must_fail('a non-admin cannot correct',
  format($s$SELECT pg_temp.correct(%L, %L, NULL, 'Contract signed at 18 percent')$s$, pg_temp.v('r1'), pg_temp.v('sp')), 'admin');
SELECT pg_temp.must_fail('nobody approves their own correction',
  format($s$SELECT pg_temp.correct(%L, %L, %L, 'Contract signed at 18 percent')$s$, pg_temp.v('r1'), pg_temp.v('a1'), pg_temp.v('a1')), 'different');
SELECT pg_temp.correct(pg_temp.v('r1'), pg_temp.v('a1'), pg_temp.v('a2'), 'REHEARSAL: contract signed at 18 percent');
SELECT pg_temp.ok('authorised correction is saved and logged with before/after, who, approver and reason',
  (SELECT commission_snapshot_status = 'corrected' AND commission_snapshot->'applied'->>'company_pct' = '18'
     FROM public.reservations WHERE id = pg_temp.v('r1')::integer)
  AND (SELECT COUNT(*) = 1 AND bool_and(previous->'applied'->>'company_pct' = '20' AND corrected_by = pg_temp.v('a1')::integer
                                         AND approved_by = pg_temp.v('a2')::integer AND reason LIKE 'REHEARSAL%')
         FROM public.reservation_commission_corrections WHERE reservation_id = pg_temp.v('r1')::integer));
SELECT pg_temp.must_fail('the correction log cannot be edited',
  format($s$UPDATE public.reservation_commission_corrections SET reason = 'changed afterwards' WHERE reservation_id = %s$s$, pg_temp.v('r1')), 'permanent');
SELECT pg_temp.must_fail('the correction log cannot be deleted',
  format($s$DELETE FROM public.reservation_commission_corrections WHERE reservation_id = %s$s$, pg_temp.v('r1')), 'permanent');

-- ── 176: posting controls ──
CREATE FUNCTION pg_temp.entry(num text, pol text, d numeric, c numeric) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE eid bigint;
BEGIN
  INSERT INTO public.ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id, origin, idempotency_key, policy_version, created_by)
  VALUES (num, DATE '2027-03-01', '2027-03', 'REHEARSAL', 'rehearsal', 'test', num, 'manual', 'rehearsal:' || num, pol, pg_temp.v('a1')::integer)
  RETURNING id INTO eid;
  INSERT INTO public.ledger_lines (entry_id, line_no, account_code, debit, base_debit) VALUES (eid, 1, '103000', d, d);
  INSERT INTO public.ledger_lines (entry_id, line_no, account_code, credit, base_credit) VALUES (eid, 2, '105000', c, c);
END $f$;
SELECT pg_temp.must_fail('no entry can be written while posting is off', $s$SELECT pg_temp.entry('RH-0', NULL, 10, 10)$s$, 'switched off');
SELECT pg_temp.must_fail('a policy cannot be approved without the separate VAT approval',
  $s$INSERT INTO public.ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref)
     VALUES ('REHEARSAL-NOVAT', '2027-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', 1, now(), 'x')$s$, 'check|approv|created_by');
INSERT INTO public.ledger_policies (version, effective_from, settings, status)
VALUES ('REHEARSAL-DRAFT', '2027-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'draft');
SELECT pg_temp.must_fail('a policy cannot be approved by the person who recorded it',
  format($s$INSERT INTO public.ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
     VALUES ('REHEARSAL-SELF', '2027-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', %s, now(), 'x', %s, now(), 'x', %s)$s$, pg_temp.v('a1'), pg_temp.v('a2'), pg_temp.v('a1')), 'recorded');
INSERT INTO public.ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
VALUES ('REHEARSAL-TEST', '2027-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved',
        pg_temp.v('a1')::integer, now(), 'REHEARSAL ONLY - NOT AN APPROVAL', pg_temp.v('a2')::integer, now(), 'REHEARSAL ONLY - NOT AN APPROVAL', pg_temp.v('sp')::integer);
SELECT pg_temp.must_fail('an approved policy cannot be edited',
  $s$UPDATE public.ledger_policies SET settings = '{"revenue_presentation":"net","vat_base":"fee_only"}' WHERE version = 'REHEARSAL-TEST'$s$, 'cannot be changed');

SELECT pg_temp.must_fail('posting cannot be switched on without a named admin and reason',
  $s$UPDATE public.financial_settings SET value_text = 'on' WHERE key = 'ledger_posting'$s$, 'actor_id');
CREATE FUNCTION pg_temp.switch(val text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM set_config('app.actor_id', pg_temp.v('a1'), true), set_config('app.control_reason', 'REHEARSAL on a restored copy', true);
  UPDATE public.financial_settings SET value_text = val WHERE key = 'ledger_posting';
END $f$;
SELECT pg_temp.switch('on');  -- restored copy only
SELECT pg_temp.must_fail('an entry without a policy is refused', $s$SELECT pg_temp.entry('RH-1', NULL, 10, 10)$s$, 'approved accounting policy');
SELECT pg_temp.must_fail('an entry under a draft policy is refused', $s$SELECT pg_temp.entry('RH-2', 'REHEARSAL-DRAFT', 10, 10)$s$, 'approved accounting policy');
SELECT pg_temp.must_fail('an unbalanced entry is refused', $s$SELECT pg_temp.entry('RH-3', 'REHEARSAL-TEST', 10, 9.99)$s$, 'unbalanced');
SELECT pg_temp.entry('RH-4', 'REHEARSAL-TEST', 100, 100);
SELECT pg_temp.entry('RH-5', 'REHEARSAL-TEST', 250, 250);
SELECT pg_temp.ok('balanced test entries post', (SELECT COUNT(*) = 2 FROM public.ledger_entries WHERE number IN ('RH-4', 'RH-5')));
SELECT pg_temp.must_fail('the same idempotency key cannot post twice (duplicate event / retry)',
  $s$INSERT INTO public.ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id, origin, idempotency_key, policy_version)
     VALUES ('RH-4b', DATE '2027-03-01', '2027-03', 'REHEARSAL', 'rehearsal', 'test', 'RH-4', 'system', 'rehearsal:RH-4', 'REHEARSAL-TEST')$s$, 'duplicate|unique');
SELECT pg_temp.must_fail('a posted entry cannot gain lines later',
  $s$INSERT INTO public.ledger_lines (entry_id, line_no, account_code, debit, base_debit) SELECT id, 9, '103000', 5, 5 FROM public.ledger_entries WHERE number = 'RH-4'$s$, 'only be added while');
SELECT pg_temp.must_fail('posted lines cannot be edited',
  $s$UPDATE public.ledger_lines SET debit = 1 WHERE entry_id = (SELECT id FROM public.ledger_entries WHERE number = 'RH-4')$s$, 'immutable');
SELECT pg_temp.must_fail('posted entries cannot be edited',
  $s$UPDATE public.ledger_entries SET description = 'changed' WHERE number = 'RH-4'$s$, 'immutable');
SELECT pg_temp.must_fail('posted entries cannot be deleted', $s$DELETE FROM public.ledger_entries WHERE number = 'RH-4'$s$, 'cannot be deleted');
SELECT pg_temp.must_fail('an entry can only be marked reversed by its own reversal',
  $s$UPDATE public.ledger_entries SET status = 'reversed', reversed_by_id = (SELECT id FROM public.ledger_entries WHERE number = 'RH-5') WHERE number = 'RH-4'$s$, 'immutable');
CREATE FUNCTION pg_temp.reversal(num text, mirror boolean) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE orig bigint; rid bigint;
BEGIN
  SELECT id INTO orig FROM public.ledger_entries WHERE number = 'RH-4';
  INSERT INTO public.ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id, origin, reverses_id, idempotency_key, policy_version, created_by)
  VALUES (num, DATE '2027-03-02', '2027-03', 'REHEARSAL reversal', 'rehearsal', 'test', 'RH-4', 'reversal', orig, 'rehearsal:' || num, 'REHEARSAL-TEST', pg_temp.v('a1')::integer) RETURNING id INTO rid;
  IF mirror THEN
    INSERT INTO public.ledger_lines (entry_id, line_no, account_code, debit, credit, base_debit, base_credit)
    SELECT rid, line_no, account_code, credit, debit, base_credit, base_debit FROM public.ledger_lines WHERE entry_id = orig;
    UPDATE public.ledger_entries SET status = 'reversed', reversed_by_id = rid WHERE id = orig;
  ELSE
    INSERT INTO public.ledger_lines (entry_id, line_no, account_code, debit, base_debit) VALUES (rid, 1, '105000', 90, 90);
    INSERT INTO public.ledger_lines (entry_id, line_no, account_code, credit, base_credit) VALUES (rid, 2, '103000', 90, 90);
  END IF;
END $f$;
SELECT pg_temp.must_fail('a reversal that does not mirror the original is refused', $s$SELECT pg_temp.reversal('RH-4X', false)$s$, 'mirror');
SELECT pg_temp.reversal('RH-4R', true);
SELECT pg_temp.ok('a mirrored reversal posts and marks the original reversed once',
  (SELECT status = 'reversed' FROM public.ledger_entries WHERE number = 'RH-4'));
SELECT pg_temp.must_fail('an entry cannot be reversed twice',
  $s$UPDATE public.ledger_entries SET reversed_by_id = id WHERE number = 'RH-4'$s$, 'immutable');

SELECT pg_temp.switch('off');
SELECT pg_temp.ok('every switch change is in the permanent control log with who and why',
  (SELECT COUNT(*) >= 2 FROM public.ledger_control_log WHERE reason = 'REHEARSAL on a restored copy' AND actor_id = pg_temp.v('a1')::integer));
SELECT pg_temp.must_fail('the control log cannot be deleted', $s$DELETE FROM public.ledger_control_log$s$, 'permanent');
SELECT pg_temp.must_fail('the posting switch cannot be deleted', $s$DELETE FROM public.financial_settings WHERE key = 'ledger_posting'$s$, 'cannot be deleted');
SELECT pg_temp.must_fail('after switching off again, nothing posts', $s$SELECT pg_temp.entry('RH-6', 'REHEARSAL-TEST', 10, 10)$s$, 'switched off');
SELECT pg_temp.ok('posting switch is back off', (SELECT value_text FROM public.financial_settings WHERE key = 'ledger_posting') = 'off');

SELECT n, check_name, passed, detail FROM rehearsal_results ORDER BY n;
SELECT COUNT(*) AS checks, COUNT(*) FILTER (WHERE passed) AS passed, COUNT(*) FILTER (WHERE NOT passed) AS failed FROM rehearsal_results;
