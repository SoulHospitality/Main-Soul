-- Sync stored min_nights: GAIA projects = 3, everyone else = 4
UPDATE units
SET min_nights = CASE
  WHEN LOWER(COALESCE(project, '') || ' ' || COALESCE(compound, '') || ' ' || COALESCE(area, ''))
       LIKE '%gaia%' THEN 3
  ELSE 4
END,
updated_at = now();
