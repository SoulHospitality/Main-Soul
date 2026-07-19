-- Canonicalize project name Gaia / gaia / etc. → GAIA

UPDATE units
SET
  compound = 'GAIA',
  updated_at = now()
WHERE lower(btrim(compound)) = 'gaia'
  AND compound IS DISTINCT FROM 'GAIA';

UPDATE units
SET
  project = 'GAIA',
  updated_at = now()
WHERE lower(btrim(project)) = 'gaia'
  AND project IS DISTINCT FROM 'GAIA';

UPDATE location_projects
SET
  name = 'GAIA',
  updated_at = now()
WHERE lower(btrim(name)) = 'gaia'
  AND name IS DISTINCT FROM 'GAIA';
