-- Unified audit log: every audit row now carries the reservation and unit it touched,
-- plus a snapshot of the unit code and the actor, so the one Audit Log page can filter
-- by unit code and keep showing names after a unit or a staff account is deleted.

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS reservation_id integer,
  ADD COLUMN IF NOT EXISTS unit_id uuid,
  ADD COLUMN IF NOT EXISTS unit_code text,
  ADD COLUMN IF NOT EXISTS actor_name text,
  ADD COLUMN IF NOT EXISTS actor_role text;

-- Works out which reservation / unit an audit row is about from its entity and details.
-- Never raises: a failed lookup leaves the columns empty rather than losing the audit row.
CREATE OR REPLACE FUNCTION public.audit_log_fill_target() RETURNS trigger AS $$
DECLARE
  d jsonb := COALESCE(NEW.details, '{}'::jsonb);
  et text := lower(COALESCE(NEW.entity_type, ''));
  eid text := COALESCE(NEW.entity_id, '');
  uuid_re text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  int_re text := '^[0-9]{1,9}$';
  v_res integer;
  v_unit uuid;
BEGIN
  BEGIN
    IF NEW.reservation_id IS NULL THEN
      IF et = 'reservation' AND eid ~ int_re THEN
        v_res := eid::integer;
      ELSIF COALESCE(d->>'reservation_id', '') ~ int_re THEN
        v_res := (d->>'reservation_id')::integer;
      ELSIF et = 'payment' AND eid ~ int_re THEN
        SELECT p.reservation_id INTO v_res FROM public.payments p WHERE p.id = eid::integer;
      ELSIF et = 'housekeeping_task' AND eid ~ int_re THEN
        SELECT h.reservation_id INTO v_res FROM public.housekeeping_tasks h WHERE h.id = eid::integer;
      END IF;
      NEW.reservation_id := v_res;
    END IF;

    IF NEW.unit_id IS NULL THEN
      IF et = 'unit' AND eid ~ uuid_re THEN
        v_unit := eid::uuid;
      ELSIF COALESCE(d->>'to_unit_id', '') ~ uuid_re THEN
        v_unit := (d->>'to_unit_id')::uuid;
      ELSIF COALESCE(d->>'unit_id', '') ~ uuid_re THEN
        v_unit := (d->>'unit_id')::uuid;
      END IF;
      IF v_unit IS NULL AND NEW.reservation_id IS NOT NULL THEN
        SELECT r.unit_id INTO v_unit FROM public.reservations r WHERE r.id = NEW.reservation_id;
      END IF;
      IF v_unit IS NULL AND eid ~ int_re THEN
        IF et = 'housekeeping_task' THEN
          SELECT h.unit_id INTO v_unit FROM public.housekeeping_tasks h WHERE h.id = eid::integer;
        ELSIF et = 'maintenance_ticket' THEN
          SELECT m.unit_id INTO v_unit FROM public.maintenance_tickets m WHERE m.id = eid::integer;
        ELSIF et = 'unit_inspection' THEN
          SELECT i.unit_id INTO v_unit FROM public.unit_inspections i WHERE i.id = eid::integer;
        END IF;
      END IF;
      IF v_unit IS NULL AND et = 'booking' AND eid ~ uuid_re THEN
        SELECT b.unit_id INTO v_unit FROM public.bookings b WHERE b.id = eid::uuid;
      END IF;
      NEW.unit_id := v_unit;
    END IF;

    IF NEW.unit_code IS NULL AND NEW.unit_id IS NOT NULL THEN
      SELECT NULLIF(btrim(u.unit_number), '') INTO NEW.unit_code FROM public.units u WHERE u.id = NEW.unit_id;
    END IF;

    IF NEW.actor_name IS NULL AND NEW.user_id IS NOT NULL THEN
      SELECT s.full_name, s.role INTO NEW.actor_name, NEW.actor_role
      FROM public.staff_users s WHERE s.id = NEW.user_id;
    END IF;
  EXCEPTION WHEN others THEN
    -- Keep the audit row even if a lookup fails.
    NULL;
  END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill existing rows once through a temporary UPDATE trigger.
DROP TRIGGER IF EXISTS audit_log_backfill_target ON public.audit_log;
CREATE TRIGGER audit_log_backfill_target BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_fill_target();
UPDATE public.audit_log SET reservation_id = reservation_id
WHERE reservation_id IS NULL OR unit_id IS NULL OR actor_name IS NULL;
DROP TRIGGER audit_log_backfill_target ON public.audit_log;

DROP TRIGGER IF EXISTS audit_log_fill_target ON public.audit_log;
CREATE TRIGGER audit_log_fill_target BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_fill_target();

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON public.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log (action);
CREATE INDEX IF NOT EXISTS idx_audit_log_reservation ON public.audit_log (reservation_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_unit ON public.audit_log (unit_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_unit_code ON public.audit_log (lower(unit_code));
