-- Ops overhaul: collection proof, petty cash links, checkout assignee, assignment log,
-- check-in cancel / date change, manager comments, attendance photos, task photos, cleaning.

-- Petty cash rows created automatically by ops actions (already journaled elsewhere).
ALTER TABLE public.petty_cash
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS source_ref text;
CREATE INDEX IF NOT EXISTS idx_petty_cash_source ON public.petty_cash (source);

-- Separate checkout handler.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ops_checkout_assigned_to integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ops_checkout_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_checkout_assigned_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL;

-- Check-in cancellation by ops.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ops_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_cancelled_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ops_cancel_comment text,
  ADD COLUMN IF NOT EXISTS ops_cancel_refund_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS ops_cancel_refund_method varchar(30);

-- Stay length changed by ops: positive = collect more, negative = refund.
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS ops_adjust_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS ops_adjust_comment text,
  ADD COLUMN IF NOT EXISTS ops_adjust_at timestamptz,
  ADD COLUMN IF NOT EXISTS ops_adjust_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL;

-- Insurance damage evidence and optional owner sharing (approved by the Operations Manager).
ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS insurance_damage_photo_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS insurance_damage_share_status varchar(20),
  ADD COLUMN IF NOT EXISTS insurance_damage_share_reviewed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS insurance_damage_share_reviewed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ops_assignment_log (
  id serial PRIMARY KEY,
  reservation_id integer REFERENCES public.reservations(id) ON DELETE CASCADE,
  housekeeping_task_id integer REFERENCES public.housekeeping_tasks(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL,
  from_staff_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  to_staff_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  reason text,
  changed_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_assignment_log_res_idx ON public.ops_assignment_log (reservation_id);

CREATE TABLE IF NOT EXISTS public.ops_reservation_comments (
  id serial PRIMARY KEY,
  reservation_id integer NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  kind varchar(20) NOT NULL DEFAULT 'checkin',
  comment text NOT NULL,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_reservation_comments_res_idx ON public.ops_reservation_comments (reservation_id);

CREATE TABLE IF NOT EXISTS public.ops_attendance (
  id serial PRIMARY KEY,
  staff_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CHECK (kind IN ('in', 'out')),
  photo_url text NOT NULL,
  lat numeric,
  lng numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ops_attendance_staff_idx ON public.ops_attendance (staff_id, created_at DESC);

ALTER TABLE public.staff_tasks
  ADD COLUMN IF NOT EXISTS completion_photo_url text;

-- Cleaning: manual cleans, editable clean date.
ALTER TABLE public.housekeeping_tasks
  ADD COLUMN IF NOT EXISTS clean_date date,
  ADD COLUMN IF NOT EXISTS created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL;

ALTER TABLE public.housekeeping_tasks DROP CONSTRAINT IF EXISTS housekeeping_tasks_source_check;
ALTER TABLE public.housekeeping_tasks
  ADD CONSTRAINT housekeeping_tasks_source_check
  CHECK (source = ANY (ARRAY['pre_arrival', 'guest_request', 'manual']));
CREATE INDEX IF NOT EXISTS housekeeping_tasks_clean_date_idx ON public.housekeeping_tasks (clean_date);
