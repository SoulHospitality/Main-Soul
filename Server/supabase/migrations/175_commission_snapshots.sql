-- D-12 (approved): commission rates are saved on the reservation when it is confirmed, so a later change
-- to a unit's split or a salesperson's % only affects future reservations.
--
-- * Captured by a trigger, so every path that confirms a reservation is covered (PMS, website, chatbot,
--   channel import), on INSERT as confirmed or on the change from pending to confirmed.
-- * Existing reservations are NOT changed: their original rates are unknown, so they keep an empty
--   snapshot and appear in reservation_commission_review for manual review. Today's rate is never
--   written onto them.
-- * Once captured, a snapshot can only change through an authorised correction
--   (lib/accounting/commissionSnapshots.js), which records who, why, and the before/after values.
-- * Additive only: nothing here alters existing values or how the current books are computed.

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_snapshot jsonb;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_snapshot_at timestamptz;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS commission_snapshot_status text;
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_commission_snapshot_status_check;
ALTER TABLE public.reservations ADD CONSTRAINT reservations_commission_snapshot_status_check
  CHECK (commission_snapshot_status IS NULL OR commission_snapshot_status IN ('captured', 'needs_review', 'corrected'));

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

CREATE OR REPLACE FUNCTION public.reservation_commission_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  confirmed_states text[] := ARRAY['confirmed', 'checked_in', 'checked_out'];
  was_confirmed boolean := TG_OP = 'UPDATE' AND OLD.status = ANY (confirmed_states);
  unit_part jsonb;
  sales_part jsonb;
BEGIN
  -- A captured snapshot is read-only, except inside an authorised correction.
  IF TG_OP = 'UPDATE' AND OLD.commission_snapshot IS NOT NULL
     AND NEW.commission_snapshot IS DISTINCT FROM OLD.commission_snapshot
     AND COALESCE(current_setting('app.commission_correction', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Commission snapshot of reservation % can only change through an authorised correction', OLD.id;
  END IF;

  -- Moving a confirmed stay to another unit or salesperson keeps the saved rates and flags them for review.
  IF TG_OP = 'UPDATE' AND OLD.commission_snapshot IS NOT NULL
     AND (NEW.unit_id IS DISTINCT FROM OLD.unit_id OR NEW.sales_person_id IS DISTINCT FROM OLD.sales_person_id)
     AND COALESCE(current_setting('app.commission_correction', true), '') <> 'on' THEN
    NEW.commission_snapshot_status := 'needs_review';
  END IF;

  IF NEW.commission_snapshot IS NULL
     AND NEW.status = ANY (confirmed_states)
     AND (TG_OP = 'INSERT' OR NOT was_confirmed) THEN
    unit_part := (
      SELECT jsonb_build_object(
        'id', un.id,
        'commission_mode', COALESCE(un.commission_mode, 'A'),
        'company_commission_pct', un.company_commission_pct,
        'company_commission_owner_pct', un.company_commission_owner_pct,
        'commission_tenant_pct', un.commission_tenant_pct
      )
      FROM public.units un WHERE un.id = NEW.unit_id
    );
    sales_part := (
      SELECT jsonb_build_object('id', s.id, 'staff_code', s.staff_code, 'sales_commission_pct', COALESCE(s.sales_commission_pct, 0))
      FROM public.staff_users s WHERE s.id = NEW.sales_person_id
    );
    NEW.commission_snapshot := jsonb_build_object(
      'version', 1,
      'captured_on', 'confirmation',
      'effective_date', (now() AT TIME ZONE 'Africa/Cairo')::date,
      'unit', unit_part,
      'salesperson', sales_part,
      'basis', jsonb_build_object(
        'company', 'company_commission_pct % of the rental base (nightly price x nights); owner gets the rest',
        'owner_booked', 'company_commission_owner_pct % applies instead when the owner books the stay',
        'tenant', 'commission_tenant_pct % markup added on top of the guest price',
        'salesperson', 'sales_commission_pct % of the company commission'
      )
    );
    NEW.commission_snapshot_at := now();
    NEW.commission_snapshot_status := 'captured';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS reservations_commission_snapshot ON public.reservations;
CREATE TRIGGER reservations_commission_snapshot
  BEFORE INSERT OR UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.reservation_commission_snapshot();

-- Confirmed stays without a saved rate (everything confirmed before this migration, plus moved stays):
-- these need a person to establish the original rate. No personal data.
CREATE OR REPLACE VIEW public.reservation_commission_review AS
SELECT r.id AS reservation_id, r.status, r.check_in, r.check_out, r.unit_id, r.sales_person_id,
       r.commission_snapshot_status,
       CASE WHEN r.commission_snapshot IS NULL THEN 'original rate unknown (confirmed before rate snapshots)'
            ELSE 'unit or salesperson changed after confirmation' END AS review_reason
FROM public.reservations r
WHERE r.status IN ('confirmed', 'checked_in', 'checked_out')
  AND (r.commission_snapshot IS NULL OR r.commission_snapshot_status = 'needs_review');
