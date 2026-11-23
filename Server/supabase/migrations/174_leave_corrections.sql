-- Extra excuses HR gives a person for one pay cycle (26th–25th), on top of the 2 everyone has.
CREATE TABLE IF NOT EXISTS public.staff_excuse_grants (
  id            serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  cycle_key     text NOT NULL,              -- 'YYYY-MM' of the pay cycle (same key as payroll)
  extra         integer NOT NULL DEFAULT 1 CHECK (extra > 0),
  reason        text,
  created_by    integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_excuse_grants_staff_cycle_idx ON public.staff_excuse_grants (staff_user_id, cycle_key);

-- One excuse per person per day: the attendance grid used to add a second excuse record on a day
-- that already had a timed excuse request, so one excuse was counted twice (e.g. Saif Magdy shows
-- 2 used after using 1). Keep one record per day (approved first, then the original request).
DELETE FROM public.staff_leave_requests d
USING (
  SELECT id, row_number() OVER (
           PARTITION BY staff_user_id, start_date
           ORDER BY (status = 'approved') DESC, (start_time IS NOT NULL) DESC, id
         ) AS rn
  FROM public.staff_leave_requests
  WHERE leave_type IN ('paid_excuse', 'early_leave') AND status IN ('pending', 'approved')
) dup
WHERE d.id = dup.id AND dup.rn > 1;

-- Corrections for days the old leave logic over-deducted. Each applies only when exactly one active
-- staff member matches the name, so nobody else is changed by mistake.
DO $$
DECLARE
  ids integer[];
BEGIN
  -- Mayar: one annual leave day back.
  SELECT array_agg(id) INTO ids FROM public.staff_users
  WHERE COALESCE(is_active, 1) = 1 AND role <> 'owner'
    AND (full_name ILIKE 'mayar%' OR full_name ILIKE 'mayyar%' OR full_name ILIKE 'ميار%');
  IF cardinality(ids) = 1 THEN
    UPDATE public.staff_users SET leave_annual_days = COALESCE(leave_annual_days, 0) + 1, updated_at = now()
    WHERE id = ids[1];
  ELSE
    RAISE NOTICE 'Mayar correction skipped: % matching staff', COALESCE(cardinality(ids), 0);
  END IF;
END $$;
