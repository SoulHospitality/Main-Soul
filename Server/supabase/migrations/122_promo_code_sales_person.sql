-- Optional salesperson credited for bookings that redeem this promo code.

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS sales_person_id integer REFERENCES public.staff_users(id) ON DELETE SET NULL;
