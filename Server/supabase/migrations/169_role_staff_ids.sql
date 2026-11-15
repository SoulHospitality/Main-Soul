-- Staff IDs by role: prefix + "-" + a random 4-digit number (RS-4827, HM-1203, WD-5610, ...).
-- The number is unique across all prefixes and never equals anyone's old door-machine ID, so the door
-- machine can use the 4 digits alone. CEOs have no Staff ID; owners keep whatever they have.
-- The ID each person had before the format changes stays in legacy_staff_code (sign-in and door imports
-- still accept it until the door machine is updated).

ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS legacy_staff_code varchar(40);

DO $$
DECLARE
  r record;
  prefix text;
  digits integer;
  used integer[];
  tries integer;
BEGIN
  -- Old door numbers are off limits for new IDs.
  SELECT COALESCE(array_agg(DISTINCT NULLIF(regexp_replace(COALESCE(legacy_staff_code, staff_code, ''), '\D', '', 'g'), '')::bigint::integer)
                    FILTER (WHERE length(regexp_replace(COALESCE(legacy_staff_code, staff_code, ''), '\D', '', 'g')) BETWEEN 1 AND 9), '{}')
  INTO used
  FROM public.staff_users
  WHERE role <> 'owner';

  -- Keep the first-ever ID as the legacy one; park every staff ID so the unique index never clashes mid-way.
  UPDATE public.staff_users
  SET legacy_staff_code = COALESCE(legacy_staff_code, staff_code),
      staff_code = CASE WHEN role = 'admin' THEN NULL ELSE 'TMP-' || id END
  WHERE role <> 'owner';

  FOR r IN SELECT id, role FROM public.staff_users WHERE role NOT IN ('owner', 'admin') ORDER BY id LOOP
    prefix := CASE r.role
      WHEN 'reservations' THEN 'RS' WHEN 'reservations_web' THEN 'RS' WHEN 'reservations_manual' THEN 'RS'
      WHEN 'reservations_manager' THEN 'RM'
      WHEN 'unit_acquisition_agent' THEN 'UA' WHEN 'unit_acquisition_manager' THEN 'AM'
      WHEN 'operations' THEN 'OP' WHEN 'operations_supervisor' THEN 'OM'
      WHEN 'housekeeping' THEN 'HK' WHEN 'housekeeping_supervisor' THEN 'HS'
      WHEN 'resale' THEN 'RA' WHEN 'resale_manager' THEN 'SM'
      WHEN 'finance' THEN 'FN' WHEN 'finance_manager' THEN 'FM'
      WHEN 'hr' THEN 'HR' WHEN 'hr_supervisor' THEN 'HM'
      WHEN 'owners_relations' THEN 'OE' WHEN 'marketing_pr' THEN 'MA' WHEN 'web_developer' THEN 'WD'
      ELSE 'ST'
    END;
    tries := 0;
    LOOP
      digits := 1000 + floor(random() * 9000)::integer;
      tries := tries + 1;
      -- No digit three times in a row, never a used number.
      EXIT WHEN NOT (digits = ANY(used)) AND digits::text !~ '(\d)\1\1';
      IF tries > 5000 THEN RAISE EXCEPTION 'Could not find a free Staff ID number'; END IF;
    END LOOP;
    used := used || digits;
    UPDATE public.staff_users SET staff_code = prefix || '-' || digits::text WHERE id = r.id;
  END LOOP;
END $$;
