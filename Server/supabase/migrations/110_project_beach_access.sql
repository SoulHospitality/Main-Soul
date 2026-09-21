-- Beach access policy lives on projects; units inherit it.

ALTER TABLE public.location_projects
  ADD COLUMN IF NOT EXISTS beach_access_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS beach_access_mode text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS beach_access_adult_egp numeric(12,2),
  ADD COLUMN IF NOT EXISTS beach_access_extra_egp numeric(12,2),
  ADD COLUMN IF NOT EXISTS beach_access_days integer,
  ADD COLUMN IF NOT EXISTS beach_access_flat_egp numeric(12,2),
  ADD COLUMN IF NOT EXISTS beach_access_flat_studio_egp numeric(12,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'location_projects_beach_access_mode_check'
  ) THEN
    ALTER TABLE public.location_projects
      ADD CONSTRAINT location_projects_beach_access_mode_check
      CHECK (beach_access_mode IN ('none', 'per_guest', 'flat', 'free', 'gaia_tiers'));
  END IF;
END $$;

COMMENT ON COLUMN public.location_projects.beach_access_enabled IS
  'When false, units in this project charge no beach access fee.';
COMMENT ON COLUMN public.location_projects.beach_access_mode IS
  'none | per_guest | flat | free | gaia_tiers';

-- Backfill known coastal projects from legacy name-based rules
UPDATE public.location_projects
SET
  beach_access_enabled = true,
  beach_access_mode = 'gaia_tiers',
  beach_access_days = 7,
  updated_at = now()
WHERE beach_access_enabled = false
  AND lower(name) LIKE '%gaia%';

UPDATE public.location_projects
SET
  beach_access_enabled = true,
  beach_access_mode = 'per_guest',
  beach_access_adult_egp = 750,
  beach_access_extra_egp = 1000,
  beach_access_days = 7,
  updated_at = now()
WHERE beach_access_enabled = false
  AND (
    lower(name) ~ '(il[[:space:]]*)?monte[[:space:]]*galala'
    OR lower(name) LIKE '%ilmonte%galala%'
  );

UPDATE public.location_projects
SET
  beach_access_enabled = true,
  beach_access_mode = 'flat',
  beach_access_flat_egp = 12000,
  beach_access_flat_studio_egp = 10000,
  beach_access_days = 7,
  updated_at = now()
WHERE beach_access_enabled = false
  AND lower(name) LIKE '%hacienda%west%';

UPDATE public.location_projects
SET
  beach_access_enabled = true,
  beach_access_mode = 'free',
  beach_access_adult_egp = 0,
  beach_access_extra_egp = 0,
  beach_access_days = 7,
  updated_at = now()
WHERE beach_access_enabled = false
  AND lower(name) ~ '\md[-[:space:]]?bay\M';

UPDATE public.location_projects
SET
  beach_access_enabled = true,
  beach_access_mode = 'per_guest',
  beach_access_adult_egp = COALESCE((
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY u.access_fee_per_adult_egp)
    FROM units u
    WHERE lower(trim(COALESCE(u.project, u.compound, ''))) = location_projects.normalized_name
      AND u.access_fee_per_adult_egp IS NOT NULL
  ), 0),
  beach_access_extra_egp = 0,
  beach_access_days = COALESCE((
    SELECT mode() WITHIN GROUP (ORDER BY u.access_card_count_included)
    FROM units u
    WHERE lower(trim(COALESCE(u.project, u.compound, ''))) = location_projects.normalized_name
      AND u.access_card_count_included IS NOT NULL
  ), 7),
  updated_at = now()
WHERE beach_access_enabled = false
  AND lower(name) LIKE '%fouka%';

-- Other projects that already have unit beach rates → enable per_guest with median rates
UPDATE public.location_projects lp
SET
  beach_access_enabled = true,
  beach_access_mode = 'per_guest',
  beach_access_adult_egp = stats.adult,
  beach_access_extra_egp = stats.extra,
  beach_access_days = stats.days,
  updated_at = now()
FROM (
  SELECT
    lower(trim(COALESCE(u.project, u.compound, ''))) AS pname,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY u.access_fee_per_adult_egp)::numeric AS adult,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY u.access_fee_per_teen_egp)::numeric AS extra,
    COALESCE(mode() WITHIN GROUP (ORDER BY u.access_card_count_included), 7) AS days
  FROM units u
  WHERE COALESCE(u.listing_type, 'rent') = 'rent'
    AND u.access_fee_per_adult_egp IS NOT NULL
    AND u.access_fee_per_adult_egp > 0
  GROUP BY 1
) stats
WHERE lp.beach_access_enabled = false
  AND lp.normalized_name = stats.pname
  AND stats.adult > 0;
