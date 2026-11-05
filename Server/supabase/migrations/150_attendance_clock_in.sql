-- Lateness bands get an explicit start and an optional end (no end = until the end of the shift),
-- and every attendance penalty can be either days of pay or a fixed EGP amount.
ALTER TABLE public.hr_deduction_rules ADD COLUMN IF NOT EXISTS start_minutes integer;
ALTER TABLE public.hr_deduction_rules ADD COLUMN IF NOT EXISTS penalty_type text NOT NULL DEFAULT 'days';
ALTER TABLE public.hr_deduction_rules DROP CONSTRAINT IF EXISTS hr_deduction_rules_penalty_type_check;
ALTER TABLE public.hr_deduction_rules
  ADD CONSTRAINT hr_deduction_rules_penalty_type_check CHECK (penalty_type = ANY (ARRAY['days'::text, 'amount'::text]));

-- Existing bands only had "arrived by": each one started a minute after the previous band ended.
WITH ordered AS (
  SELECT id, LAG(end_minutes) OVER (ORDER BY end_minutes NULLS LAST, id) AS prev_end
  FROM public.hr_deduction_rules
  WHERE kind = 'lateness'
)
UPDATE public.hr_deduction_rules r
SET start_minutes = COALESCE(o.prev_end + 1, 660)
FROM ordered o
WHERE r.id = o.id AND r.start_minutes IS NULL;

-- "After 12:00" ran to midnight; it now means "until the end of the shift".
UPDATE public.hr_deduction_rules SET end_minutes = NULL WHERE kind = 'lateness' AND end_minutes >= 1440;

-- Where staff clock in from their phones.
CREATE TABLE IF NOT EXISTS public.attendance_sites (
  id serial PRIMARY KEY,
  name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  radius_m integer NOT NULL DEFAULT 300 CHECK (radius_m BETWEEN 50 AND 5000),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.attendance_sites (name, lat, lng, radius_m)
SELECT 'Soul office', 30.052776, 31.466862, 300
WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sites);

-- Fingerprint / Face ID keys (WebAuthn passkeys) registered on each person's phone.
CREATE TABLE IF NOT EXISTS public.staff_webauthn_credentials (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,
  public_key text NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS staff_webauthn_credentials_staff_idx ON public.staff_webauthn_credentials (staff_user_id);

-- Every clock in / clock out, including automatic clock-outs when someone leaves the area.
CREATE TABLE IF NOT EXISTS public.staff_clock_events (
  id serial PRIMARY KEY,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  work_date date NOT NULL,
  kind text NOT NULL CHECK (kind = ANY (ARRAY['in'::text, 'out'::text])),
  source text NOT NULL DEFAULT 'biometric' CHECK (source = ANY (ARRAY['biometric'::text, 'left_area'::text, 'hr'::text])),
  at timestamptz NOT NULL DEFAULT now(),
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  distance_m double precision,
  site_id integer REFERENCES public.attendance_sites(id),
  user_agent text,
  credential_id text
);
CREATE INDEX IF NOT EXISTS staff_clock_events_staff_day_idx ON public.staff_clock_events (staff_user_id, work_date, at);
