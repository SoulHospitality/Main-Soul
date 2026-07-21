-- Project-level facilities (shared by all units in a compound)
ALTER TABLE location_projects
  ADD COLUMN IF NOT EXISTS facilities text[] NOT NULL DEFAULT '{}';

-- Seed compound facilities for core North Coast projects (does not touch unit amenities)
UPDATE location_projects SET facilities = ARRAY[
  'Private sandy beach',
  'Crystal Lagoons',
  'Beach club / Beach hub',
  'Clubhouse',
  'Swimming pools',
  'Kids pool / water park',
  'Gym / Health club',
  'Spa & wellness',
  'Sports courts (tennis / multi-purpose)',
  'Jogging & cycling tracks',
  'Commercial strip / retail',
  'Restaurants & cafes',
  'Kids play area',
  'Hotel / hospitality',
  'Business hub',
  'Medical clinic / pharmacy',
  '24/7 security & CCTV',
  'Gated entry'
]
WHERE normalized_name = 'fouka bay';

UPDATE location_projects SET facilities = ARRAY[
  'Private sandy beach',
  'Swimmable lagoons & water features',
  'Signature swimming pool',
  'Outdoor pools',
  'KYND hotel / hospitality',
  'Commercial strip',
  'Fine dining (beachside restaurants)',
  'Gym / sports zone',
  'Sports courts (tennis / multi-purpose)',
  'Jogging & cycling tracks',
  'Kids area',
  'Clubhouse',
  'Spa / health club',
  'Medical center / pharmacy',
  '24/7 security',
  'Landscaped gardens'
]
WHERE normalized_name IN ('gaia');

UPDATE location_projects SET facilities = ARRAY[
  'Private Mediterranean beach',
  'Internal lagoons',
  'Multiple swimming pools',
  'Clubhouse / beach clubhouse',
  'Branded hotel',
  'Community hub',
  'Fully equipped gym',
  'Spa & wellness',
  'Sports arena (tennis / padel)',
  'Walking & cycling tracks',
  'Commercial hub (shops / F&B)',
  'Restaurants & cafes',
  'Kids play area',
  'Pharmacy / medical clinic',
  '24/7 security & CCTV',
  'Gated entry',
  'Maintenance services'
]
WHERE normalized_name = 'hacienda west';

UPDATE location_projects SET facilities = ARRAY[
  'Private sandy beach',
  'Crystal lagoon',
  'Multiple swimming pools',
  'Covered / ladies pool',
  'Clubhouses',
  'Health club (gym, spa, sauna, jacuzzi)',
  'Sports facilities & courts',
  'Walking, jogging & cycling tracks',
  'Commercial mall / retail',
  'Promenade restaurants & cafes',
  'Kids entertainment area',
  'Medical center & pharmacy',
  'Golf carts',
  '24/7 security & CCTV',
  'Gated entry',
  'Aqua park / water activities'
]
WHERE normalized_name IN ('d-bay', 'd bay');
