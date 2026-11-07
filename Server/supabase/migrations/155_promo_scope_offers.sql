-- Promo codes can be limited to some units, projects or destinations (empty = everywhere).
ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS unit_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS projects text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS destinations text[] NOT NULL DEFAULT '{}';

-- Offers: a named percentage off, shown as a popup on the website, for chosen destinations, projects or units.
CREATE TABLE IF NOT EXISTS public.offers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  name_ar text,
  description text,
  description_ar text,
  discount_percent numeric NOT NULL CHECK (discount_percent > 0 AND discount_percent < 100),
  unit_ids uuid[] NOT NULL DEFAULT '{}',
  projects text[] NOT NULL DEFAULT '{}',
  destinations text[] NOT NULL DEFAULT '{}',
  starts_on date,
  ends_on date,
  show_popup boolean NOT NULL DEFAULT true,
  image_url text,
  active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS offers_active_idx ON public.offers (active, starts_on, ends_on);

-- Which offer (if any) priced a website booking, so finance can see the discount.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS offer_id integer REFERENCES public.offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_discount_egp numeric;
