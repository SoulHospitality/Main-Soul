-- D-12 (approved): the commission rates a reservation uses are saved on it when it is confirmed, so a
-- later change to a unit's split or a salesperson's % only affects reservations confirmed afterwards.
--
-- * Captured by a trigger, so every path that confirms a reservation is covered (PMS, website, chatbot,
--   channel import): on INSERT as confirmed, or on the change into confirmed / checked_in / checked_out.
-- * The snapshot records the rate actually APPLIED by lib/commission.js calcReservationFinancials
--   (including the 20% default and the owner-booked rate in mode C), the raw unit and salesperson values,
--   the deciding flags, and the calculation basis, so the figure can be explained later.
-- * Existing reservations are NOT changed. Already-confirmed stays keep an empty snapshot and appear in
--   reservation_commission_review. Today's rate is never written onto them; nobody can write a snapshot
--   by hand either (only the trigger or a logged correction can).
-- * Once captured, a snapshot changes only through an authorised correction, which this trigger itself
--   logs to reservation_commission_corrections (append-only): who, approver, reason, before and after.
-- * Additive: nothing here changes existing values or how the current books are computed.

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_snapshot jsonb;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_snapshot_at timestamptz;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_snapshot_status text;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_commission_snapshot_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_commission_snapshot_status_check
  CHECK (commission_snapshot_status IS NULL OR commission_snapshot_status IN ('captured', 'needs_review', 'corrected'));
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_review_reason text;

-- Date snapshots began: a reservation created before it and confirmed later is captured but flagged,
-- because it may have been confirmed once before (an edit back to pending and forward again).
INSERT INTO public.financial_settings (key, value_text)
VALUES ('commission_snapshots_since', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.reservation_commission_corrections (
  id             serial PRIMARY KEY,
  reservation_id integer NOT NULL REFERENCES public.reservations(id),
  previous       jsonb,
  corrected      jsonb NOT NULL,
  reason         text NOT NULL CHECK (length(btrim(reason)) >= 10),
  corrected_by   integer NOT NULL,
  approved_by    integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reservation_commission_corrections_res_idx ON public.reservation_commission_corrections (reservation_id);

CREATE OR REPLACE FUNCTION public.reservation_commission_corrections_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Commission corrections are a permanent record and cannot be changed or deleted';
END $$;
DROP TRIGGER IF EXISTS reservation_commission_corrections_append_only ON public.reservation_commission_corrections;
CREATE TRIGGER reservation_commission_corrections_append_only
  BEFORE UPDATE OR DELETE ON public.reservation_commission_corrections
  FOR EACH ROW EXECUTE FUNCTION public.reservation_commission_corrections_append_only();

CREATE OR REPLACE FUNCTION public.reservation_commission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  confirmed_states text[] := ARRAY['confirmed', 'checked_in', 'checked_out'];
  correcting boolean := COALESCE(current_setting('app.commission_correction', true), '') = 'on';
  old_snap jsonb := CASE WHEN TG_OP = 'UPDATE' THEN OLD.commission_snapshot END;
  was_confirmed boolean := TG_OP = 'UPDATE' AND OLD.status = ANY (confirmed_states);
  since timestamptz;
  reason text;
  actor integer;
  approver integer;
  un record;
  sp record;
  is_owner boolean;
  mode text;
  applied_pct numeric;
  applied_source text;
  tenant_applied numeric;
BEGIN
  -- 1. Snapshot columns are written only by this trigger or by a logged correction.
  IF NOT correcting THEN
    IF NEW.commission_snapshot IS DISTINCT FROM old_snap THEN
      RAISE EXCEPTION 'Commission snapshot of reservation % can only change through an authorised correction', NEW.id;
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.commission_snapshot_at := NULL;
      NEW.commission_snapshot_status := NULL;
      NEW.commission_review_reason := NULL;
    ELSE
      NEW.commission_snapshot_at := OLD.commission_snapshot_at;
      NEW.commission_snapshot_status := OLD.commission_snapshot_status;
      NEW.commission_review_reason := OLD.commission_review_reason;
    END IF;
  END IF;

  -- 2. Authorised correction: the change is logged here, so it cannot happen without a record.
  IF correcting AND NEW.commission_snapshot IS DISTINCT FROM old_snap THEN
    reason := btrim(COALESCE(current_setting('app.commission_correction_reason', true), ''));
    actor := NULLIF(current_setting('app.commission_correction_actor', true), '')::integer;
    approver := NULLIF(current_setting('app.commission_correction_approver', true), '')::integer;
    IF length(reason) < 10 OR actor IS NULL THEN
      RAISE EXCEPTION 'A commission correction needs the person making it and a reason of at least 10 characters';
    END IF;
    IF NEW.commission_snapshot IS NULL THEN
      RAISE EXCEPTION 'A commission correction cannot remove a snapshot';
    END IF;
    INSERT INTO public.reservation_commission_corrections (reservation_id, previous, corrected, reason, corrected_by, approved_by)
    VALUES (NEW.id, old_snap, NEW.commission_snapshot, reason, actor, approver);
    NEW.commission_snapshot_at := now();
    NEW.commission_snapshot_status := 'corrected';
    NEW.commission_review_reason := NULL;
    RETURN NEW;
  END IF;

  -- 3. Saved rates stay; a change that could alter which rate applies flags the stay for review.
  IF TG_OP = 'UPDATE' AND old_snap IS NOT NULL THEN
    IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
      NEW.commission_snapshot_status := 'needs_review'; NEW.commission_review_reason := 'unit changed after confirmation';
    ELSIF NEW.sales_person_id IS DISTINCT FROM OLD.sales_person_id THEN
      NEW.commission_snapshot_status := 'needs_review'; NEW.commission_review_reason := 'salesperson changed after confirmation';
    ELSIF (COALESCE(NEW.is_owner_reservation, 0) <> 0) IS DISTINCT FROM (COALESCE(OLD.is_owner_reservation, 0) <> 0) THEN
      NEW.commission_snapshot_status := 'needs_review'; NEW.commission_review_reason := 'owner-booking flag changed after confirmation';
    ELSIF OLD.status = 'cancelled' AND NEW.status = ANY (confirmed_states) THEN
      NEW.commission_snapshot_status := 'needs_review'; NEW.commission_review_reason := 're-confirmed after cancellation: original rates kept';
    END IF;
    RETURN NEW;
  END IF;

  -- 4. Capture on confirmation. Retries are harmless: once a snapshot exists nothing here runs again.
  IF NEW.commission_snapshot IS NULL AND NEW.status = ANY (confirmed_states) AND (TG_OP = 'INSERT' OR NOT was_confirmed) THEN
    SELECT id, COALESCE(upper(commission_mode), 'A') AS mode, company_commission_pct, company_commission_owner_pct,
           commission_tenant_pct
      INTO un FROM public.units WHERE id = NEW.unit_id;
    SELECT id, staff_code, COALESCE(sales_commission_pct, 0) AS pct
      INTO sp FROM public.staff_users WHERE id = NEW.sales_person_id;

    -- Mirrors calcReservationFinancials (lib/commission.js); keep the two in step.
    is_owner := COALESCE(NEW.is_owner_reservation, 0) <> 0;
    mode := COALESCE(un.mode, 'A');
    IF mode = 'C' AND is_owner THEN
      applied_pct := COALESCE(un.company_commission_owner_pct, 0); applied_source := 'unit owner-booked %';
    ELSIF COALESCE(un.company_commission_pct, 0) > 0 THEN
      applied_pct := un.company_commission_pct; applied_source := 'unit company %';
    ELSE
      applied_pct := 20; applied_source := 'default 20% (unit has no company %)';
    END IF;
    tenant_applied := CASE WHEN mode IN ('B', 'C') AND COALESCE(un.commission_tenant_pct, 0) > 0 AND NOT is_owner
                           THEN un.commission_tenant_pct ELSE 0 END;

    NEW.commission_snapshot := jsonb_build_object(
      'version', 2,
      'captured_on', 'confirmation',
      'effective_date', (now() AT TIME ZONE 'Africa/Cairo')::date,
      'calculation', 'lib/commission.js calcReservationFinancials',
      'applied', jsonb_build_object(
        'company_pct', applied_pct,
        'company_pct_source', applied_source,
        'tenant_deduction_pct', tenant_applied,
        'sales_pct', CASE WHEN sp.id IS NULL THEN NULL ELSE sp.pct END
      ),
      'inputs', jsonb_build_object('commission_mode', mode, 'is_owner_reservation', is_owner),
      'unit', CASE WHEN un.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', un.id, 'company_commission_pct', un.company_commission_pct,
        'company_commission_owner_pct', un.company_commission_owner_pct, 'commission_tenant_pct', un.commission_tenant_pct) END,
      'salesperson', CASE WHEN sp.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', sp.id, 'staff_code', sp.staff_code, 'sales_commission_pct', sp.pct) END,
      'basis', jsonb_build_object(
        'owner_gross', 'rental base (nightly price x nights, else total less housekeeping and 15% service) less utilities and broker',
        'tenant_deduction', 'tenant_deduction_pct % of owner gross (modes B and C, not owner-booked)',
        'company', 'company_pct % of (owner gross less tenant deduction)',
        'owner', '(owner gross less tenant deduction) less company commission',
        'salesperson', 'sales_pct % of the company commission'
      )
    );
    NEW.commission_snapshot_at := now();
    NEW.commission_snapshot_status := 'captured';

    BEGIN
      since := (SELECT value_text FROM public.financial_settings WHERE key = 'commission_snapshots_since')::timestamptz;
    EXCEPTION WHEN others THEN since := NULL;
    END;
    IF un.id IS NULL THEN
      NEW.commission_snapshot_status := 'needs_review'; NEW.commission_review_reason := 'no unit at confirmation';
    ELSIF TG_OP = 'UPDATE' AND since IS NOT NULL AND OLD.created_at < since THEN
      NEW.commission_snapshot_status := 'needs_review';
      NEW.commission_review_reason := 'created before rate snapshots began: confirm it was not confirmed earlier at another rate';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reservations_commission_snapshot ON public.reservations;
CREATE TRIGGER reservations_commission_snapshot
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.reservation_commission_snapshot();

-- Confirmed stays whose rates need a person to establish or re-check them. No personal data.
CREATE OR REPLACE VIEW public.reservation_commission_review AS
SELECT r.id AS reservation_id, r.status, r.check_in, r.check_out, r.unit_id, r.sales_person_id,
       r.commission_snapshot_status,
       CASE WHEN r.commission_snapshot IS NULL THEN 'original rate unknown (confirmed before rate snapshots)'
            ELSE COALESCE(r.commission_review_reason, 'needs review') END AS review_reason
FROM public.reservations r
WHERE r.status IN ('confirmed', 'checked_in', 'checked_out')
  AND (r.commission_snapshot IS NULL OR r.commission_snapshot_status = 'needs_review');
