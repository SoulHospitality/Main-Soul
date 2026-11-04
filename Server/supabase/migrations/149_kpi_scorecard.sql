-- KPI scorecard: an importance weight per KPI (1–5) for the person's overall score, an optional name
-- and notes, and a new "check-ins handled" metric for the operations team.

ALTER TABLE public.kpi_targets
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_weight_check;
ALTER TABLE public.kpi_targets
  ADD CONSTRAINT kpi_targets_weight_check CHECK (weight BETWEEN 1 AND 5);

ALTER TABLE public.kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_metric_check;
ALTER TABLE public.kpi_targets
  ADD CONSTRAINT kpi_targets_metric_check
  CHECK (metric = ANY (ARRAY['reservations'::text, 'unit_acquisitions'::text, 'reviews'::text, 'check_ins'::text]));
