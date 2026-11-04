-- Website and Manual reservations are now one "Reservations" role that handles both
-- (the existing 'reservations' role already covers website requests and manual bookings).
-- Every move is written to the audit log so the change shows on the Audit Log page.
WITH moved AS (
  SELECT id, full_name, role AS old_role
  FROM public.staff_users
  WHERE role IN ('reservations_web', 'reservations_manual')
),
updated AS (
  UPDATE public.staff_users s
  SET role = 'reservations', updated_at = now()
  FROM moved
  WHERE s.id = moved.id
  RETURNING s.id, moved.full_name, moved.old_role
)
INSERT INTO public.audit_log (user_id, action, entity_type, entity_id, details)
SELECT NULL, 'CHANGE_ROLE', 'staff_user', updated.id::text,
       jsonb_build_object(
         'staff_name', updated.full_name,
         'reason', 'Website and manual reservations merged into one Reservations role',
         'changes', jsonb_build_object('role', jsonb_build_object('from', updated.old_role, 'to', 'reservations'))
       )
FROM updated;
