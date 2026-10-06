CREATE TABLE IF NOT EXISTS public.site_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL
);

ALTER TABLE public.units ADD COLUMN IF NOT EXISTS display_order integer;

CREATE INDEX IF NOT EXISTS idx_units_area_display_order ON public.units (area, display_order);

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
