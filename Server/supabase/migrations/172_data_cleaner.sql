-- Data cleaner: removes old logs and temporary records on a schedule so the database stays
-- inside the Supabase free plan (500 MB). Business records (reservations, payments, finance,
-- guests, staff, payroll, conversations) are never touched.

CREATE TABLE IF NOT EXISTS public.data_cleaner_config (
  id            integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled       boolean NOT NULL DEFAULT true,
  -- The plan's database limit; above 80% of it the cleaner runs in "tight" mode.
  size_limit_mb integer NOT NULL DEFAULT 500,
  -- Per-rule overrides: { "<rule key>": { "enabled": true, "days": 30 } }
  rules         jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by    integer,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.data_cleaner_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.data_cleaner_runs (
  id           serial PRIMARY KEY,
  trigger      text NOT NULL DEFAULT 'auto' CHECK (trigger IN ('auto', 'manual', 'tight')),
  dry_run      boolean NOT NULL DEFAULT false,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  size_before  bigint,
  size_after   bigint,
  -- { "<rule key>": rows removed (or that would be removed on a preview) }
  results      jsonb NOT NULL DEFAULT '{}'::jsonb,
  error        text,
  started_by   integer
);
CREATE INDEX IF NOT EXISTS data_cleaner_runs_started_idx ON public.data_cleaner_runs (started_at DESC);
