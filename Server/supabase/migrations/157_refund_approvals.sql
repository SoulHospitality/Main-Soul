-- A refund on a cancelled reservation needs two approvals before finance pays it:
-- the reservations manager, then the CEO (admin).
ALTER TABLE public.reservation_cancel_requests
  ADD COLUMN IF NOT EXISTS manager_approved_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manager_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_approved_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS admin_approved_at timestamptz;
