-- Photos required when operations changes the insurance held at checkout.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS insurance_adjust_photo_urls text[] NOT NULL DEFAULT '{}';
