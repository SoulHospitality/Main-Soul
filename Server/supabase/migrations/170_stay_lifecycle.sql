-- Stay lifecycle for operations: a unit is occupied from check-in, needs cleaning after checkout and is
-- available again once cleaned. Checkout creates its own turnover clean.

ALTER TABLE public.units DROP CONSTRAINT IF EXISTS units_ops_status_check;
ALTER TABLE public.units
  ADD CONSTRAINT units_ops_status_check
  CHECK (ops_status IS NULL OR ops_status = ANY (ARRAY['available', 'occupied', 'needs_cleaning', 'maintenance']));

ALTER TABLE public.housekeeping_tasks DROP CONSTRAINT IF EXISTS housekeeping_tasks_source_check;
ALTER TABLE public.housekeeping_tasks
  ADD CONSTRAINT housekeeping_tasks_source_check
  CHECK (source = ANY (ARRAY['pre_arrival', 'guest_request', 'manual', 'checkout']));

ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS checked_out_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL;
