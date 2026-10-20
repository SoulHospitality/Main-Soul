-- Named petty cash accounts funded from treasury, and check-in custom bills that wait for the line manager.

CREATE TABLE IF NOT EXISTS public.petty_cash_accounts (
  id serial PRIMARY KEY,
  location_key text NOT NULL UNIQUE,
  name text NOT NULL,
  destination text,
  treasury_account_code text,
  opening_amount numeric NOT NULL DEFAULT 0,
  created_by integer REFERENCES public.staff_users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.petty_cash_accounts (location_key, name, destination, opening_amount)
VALUES
  ('north_coast', 'North Coast', 'North Coast', 0),
  ('sokhna', 'Sokhna', 'Ain Sokhna', 0)
ON CONFLICT (location_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ops_custom_bill_requests (
  id serial PRIMARY KEY,
  reservation_id integer NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  requested_by integer NOT NULL REFERENCES public.staff_users(id),
  bill jsonb NOT NULL,
  comment text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  reviewed_by integer REFERENCES public.staff_users(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ops_custom_bill_requests_res_idx
  ON public.ops_custom_bill_requests (reservation_id, created_at DESC);
