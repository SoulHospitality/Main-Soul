-- Weekly days off per staff member, and a manual day-off attendance status.
ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS days_off text[] NOT NULL DEFAULT '{}';

DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'staff_attendance'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%on_time%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.staff_attendance DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE public.staff_attendance
  ADD CONSTRAINT staff_attendance_status_check
  CHECK (status IN ('on_time', 'late', 'no_show', 'day_off'));
