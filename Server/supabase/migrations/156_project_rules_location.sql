-- Projects carry their own house rules and location (map link). Units no longer have a location of their own.
ALTER TABLE public.location_projects
  ADD COLUMN IF NOT EXISTS rules text,
  ADD COLUMN IF NOT EXISTS rules_ar text,
  ADD COLUMN IF NOT EXISTS location_url text,
  ADD COLUMN IF NOT EXISTS address text;

-- Keep the map link each project's units already had, so nothing is lost.
UPDATE public.location_projects p
SET location_url = sub.url
FROM (
  SELECT DISTINCT ON (lower(trim(COALESCE(u.compound, u.project)))) lower(trim(COALESCE(u.compound, u.project))) AS name, u.source_url AS url
  FROM public.units u
  WHERE COALESCE(u.source_url, '') ~* '^https?://'
  ORDER BY lower(trim(COALESCE(u.compound, u.project))), u.updated_at DESC NULLS LAST
) sub
WHERE p.location_url IS NULL AND p.normalized_name = sub.name;
