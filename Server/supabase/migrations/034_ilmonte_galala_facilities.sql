-- 034: Seed IL Monte Galala project + compound facilities (Ain Sokhna)

INSERT INTO location_projects (
  destination, name, normalized_destination, normalized_name, sort_order, facilities
)
SELECT
  'Ain Sokhna',
  'IL Monte Galala',
  'ain sokhna',
  'il monte galala',
  50,
  ARRAY[
    'Private Red Sea beach (1.3–1.4 km shoreline)',
    'Crystal Lagoons — mountain-top lagoon (Crystal Lagoons®)',
    'Lagoon clubhouse & lagoon shoreline',
    'Seafront Beach Hub',
    'Maestà mountain-top promenade',
    'Sky Summit Restaurant',
    'Adventure Park / Basecamp (Rock ’n Rope)',
    'Via Ferrata & rock climbing',
    'Zip lining',
    'Mountain biking & eco desert trails',
    'Desert campsite & beach camp',
    'Tethered balloon rides',
    'Spa & wellness / thalassotherapy',
    'Infinity & outdoor swimming pools',
    'Kids play area & children beach clubs',
    'Sports zone & sporting facilities',
    'Art & Fashion School',
    'Art Walkway / open-air art symposium',
    'Marina',
    'Restaurants & cafes',
    'Luxury shopping / Old Town retail',
    'Green spaces & botanical gardens',
    '5-star hotels / hospitality',
    'Walking & jogging tracks',
    '24/7 security & gated entry'
  ]::text[]
WHERE NOT EXISTS (
  SELECT 1 FROM location_projects
  WHERE normalized_name = 'il monte galala'
    AND normalized_destination = 'ain sokhna'
);

UPDATE location_projects SET
  facilities = ARRAY[
    'Private Red Sea beach (1.3–1.4 km shoreline)',
    'Crystal Lagoons — mountain-top lagoon (Crystal Lagoons®)',
    'Lagoon clubhouse & lagoon shoreline',
    'Seafront Beach Hub',
    'Maestà mountain-top promenade',
    'Sky Summit Restaurant',
    'Adventure Park / Basecamp (Rock ’n Rope)',
    'Via Ferrata & rock climbing',
    'Zip lining',
    'Mountain biking & eco desert trails',
    'Desert campsite & beach camp',
    'Tethered balloon rides',
    'Spa & wellness / thalassotherapy',
    'Infinity & outdoor swimming pools',
    'Kids play area & children beach clubs',
    'Sports zone & sporting facilities',
    'Art & Fashion School',
    'Art Walkway / open-air art symposium',
    'Marina',
    'Restaurants & cafes',
    'Luxury shopping / Old Town retail',
    'Green spaces & botanical gardens',
    '5-star hotels / hospitality',
    'Walking & jogging tracks',
    '24/7 security & gated entry'
  ]::text[],
  name = 'IL Monte Galala',
  destination = 'Ain Sokhna',
  updated_at = now()
WHERE normalized_name IN ('il monte galala', 'ilmonte galala', 'monte galala');
