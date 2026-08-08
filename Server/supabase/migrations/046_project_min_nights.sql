-- 046_project_min_nights.sql
-- Per-project minimum stay (nights) on Destinations & Projects catalog

ALTER TABLE public.location_projects
  ADD COLUMN IF NOT EXISTS min_nights integer NOT NULL DEFAULT 4;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'location_projects_min_nights_check'
  ) THEN
    ALTER TABLE public.location_projects
      ADD CONSTRAINT location_projects_min_nights_check CHECK (min_nights >= 1);
  END IF;
END $$;

-- Preserve previous heuristic: GAIA → 3, everyone else → 4
UPDATE public.location_projects
SET min_nights = CASE
  WHEN lower(COALESCE(name, '') || ' ' || COALESCE(normalized_name, '')) LIKE '%gaia%' THEN 3
  ELSE 4
END,
updated_at = now();

-- Sync denormalized units.min_nights from matching project catalog rows
UPDATE public.units u
SET min_nights = lp.min_nights,
    updated_at = now()
FROM public.location_projects lp
WHERE lower(trim(COALESCE(u.project, ''))) = lp.normalized_name
   OR lower(trim(COALESCE(u.compound, ''))) = lp.normalized_name;

-- Units with no catalog match keep prior GAIA/else heuristic
UPDATE public.units
SET min_nights = CASE
  WHEN LOWER(COALESCE(project, '') || ' ' || COALESCE(compound, '') || ' ' || COALESCE(area, ''))
       LIKE '%gaia%' THEN 3
  ELSE COALESCE(NULLIF(min_nights, 0), 4)
END,
updated_at = now()
WHERE NOT EXISTS (
  SELECT 1 FROM public.location_projects lp
  WHERE lower(trim(COALESCE(units.project, ''))) = lp.normalized_name
     OR lower(trim(COALESCE(units.compound, ''))) = lp.normalized_name
);
