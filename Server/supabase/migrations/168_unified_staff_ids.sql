-- One Staff ID format for every staff member, renumbered from scratch: SH-0001, SH-0002, …
-- in the order the accounts were created. Every existing ID changes, including ones already shaped SH-####.
-- The previous ID is kept in legacy_staff_code, so sign-in and door attendance imports still accept it
-- until the door machine is updated. Owners are not staff and keep whatever they have.

ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS legacy_staff_code varchar(40);

-- Park every staff ID on a placeholder first so the unique index never sees a clash mid-way.
UPDATE public.staff_users
SET legacy_staff_code = staff_code,
    staff_code = 'TMP-' || id
WHERE role <> 'owner';

UPDATE public.staff_users s
SET staff_code = 'SH-' || lpad(n.num::text, 4, '0')
FROM (
  SELECT id, row_number() OVER (ORDER BY created_at NULLS LAST, id) AS num
  FROM public.staff_users
  WHERE role <> 'owner'
) n
WHERE n.id = s.id;
