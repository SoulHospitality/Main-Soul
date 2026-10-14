-- Every staff account takes Friday as their weekly day off.
UPDATE public.staff_users
SET days_off = ARRAY['fri']::text[],
    updated_at = now()
WHERE role <> 'owner';
