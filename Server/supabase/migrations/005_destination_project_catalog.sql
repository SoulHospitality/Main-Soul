-- Destination ↔ Project catalog (SoulHospitality-style)
-- Destination ≈ guest `units.area`; Project ≈ guest `units.compound` / ops `units.project`

CREATE TABLE IF NOT EXISTS location_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination text NOT NULL,
  name text NOT NULL,
  normalized_destination text NOT NULL,
  normalized_name text NOT NULL,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_projects_dest_name_uq UNIQUE (normalized_destination, normalized_name)
);

CREATE INDEX IF NOT EXISTS location_projects_destination_idx
  ON location_projects (normalized_destination);

-- Seed SoulHospitality destinations + known North Coast / Red Sea projects
INSERT INTO location_projects (destination, name, normalized_destination, normalized_name, image_url, sort_order)
VALUES
  ('North Coast', 'Fouka Bay', 'north coast', 'fouka bay', '/compounds/fouka-bay.jpg', 10),
  ('North Coast', 'Gaia', 'north coast', 'gaia', '/compounds/gaia.jpg', 20),
  ('North Coast', 'Hacienda West', 'north coast', 'hacienda west', '/compounds/hacienda-west.jpg', 30),
  ('North Coast', 'D-Bay', 'north coast', 'd-bay', '/compounds/d-bay.jpg', 40),
  ('North Coast', 'Marassi', 'north coast', 'marassi', '/compounds/hacienda-west.jpg', 50),
  ('Ain Sokhna', 'Ain Sokhna', 'ain sokhna', 'ain sokhna', '/compounds/il-monte-galala.webp', 10),
  ('Ain Sokhna', 'Porto Sokhna', 'ain sokhna', 'porto sokhna', '/compounds/il-monte-galala.webp', 20),
  ('Red Sea', 'Ain Sokhna', 'red sea', 'ain sokhna', '/compounds/il-monte-galala.webp', 10),
  ('Down Town', 'Downtown Cairo', 'down town', 'downtown cairo', NULL, 10),
  ('Zamalek', 'Zamalek', 'zamalek', 'zamalek', NULL, 10),
  ('El Sheikh Zayed', 'Sheikh Zayed', 'el sheikh zayed', 'sheikh zayed', NULL, 10),
  ('New Cairo', 'New Cairo', 'new cairo', 'new cairo', NULL, 10),
  ('Alexandria', 'Alexandria', 'alexandria', 'alexandria', NULL, 10),
  ('Aswan', 'Aswan', 'aswan', 'aswan', NULL, 10),
  ('Luxor', 'Luxor', 'luxor', 'luxor', NULL, 10)
ON CONFLICT (normalized_destination, normalized_name) DO NOTHING;

-- Backfill any distinct compound/area pairs already on units
INSERT INTO location_projects (destination, name, normalized_destination, normalized_name, sort_order)
SELECT DISTINCT
  COALESCE(NULLIF(trim(area), ''), 'North Coast'),
  COALESCE(NULLIF(trim(compound), ''), 'General'),
  lower(trim(COALESCE(NULLIF(trim(area), ''), 'North Coast'))),
  lower(trim(COALESCE(NULLIF(trim(compound), ''), 'General'))),
  100
FROM units
WHERE compound IS NOT NULL AND trim(compound) <> ''
ON CONFLICT (normalized_destination, normalized_name) DO NOTHING;
