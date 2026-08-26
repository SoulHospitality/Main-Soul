-- Clear the holiday-request queue. Approved casual/annual days are restored
-- so staff are not left with a deduction for a request that no longer exists.

UPDATE public.staff_users u
SET leave_casual_days = COALESCE(u.leave_casual_days, 0) + s.days,
    updated_at = now()
FROM (
  SELECT staff_user_id, SUM(days)::int AS days
  FROM public.staff_leave_requests
  WHERE status = 'approved'
    AND leave_type = 'casual'
  GROUP BY staff_user_id
) s
WHERE u.id = s.staff_user_id;

UPDATE public.staff_users u
SET leave_annual_days = COALESCE(u.leave_annual_days, 0) + s.days,
    updated_at = now()
FROM (
  SELECT staff_user_id, SUM(days)::int AS days
  FROM public.staff_leave_requests
  WHERE status = 'approved'
    AND leave_type IN ('annual', 'holiday')
  GROUP BY staff_user_id
) s
WHERE u.id = s.staff_user_id;

DELETE FROM public.staff_leave_requests;
