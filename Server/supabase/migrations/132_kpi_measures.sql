-- KPI measures: reservation count or value, units added, and check-in review average.
-- Rewards are no longer entered. Progress is calculated from live records.

UPDATE public.kpi_targets
SET metric = 'reservations'
WHERE metric NOT IN ('reservations', 'unit_acquisitions', 'reviews');

ALTER TABLE public.kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_metric_check;
ALTER TABLE public.kpi_targets
  ADD CONSTRAINT kpi_targets_metric_check
  CHECK (metric = ANY (ARRAY['reservations'::text, 'unit_acquisitions'::text, 'reviews'::text]));

ALTER TABLE public.kpi_targets
  ADD COLUMN IF NOT EXISTS measure text NOT NULL DEFAULT 'count';

ALTER TABLE public.kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_measure_check;
ALTER TABLE public.kpi_targets
  ADD CONSTRAINT kpi_targets_measure_check
  CHECK (measure = ANY (ARRAY['count'::text, 'value'::text, 'average'::text]));

ALTER TABLE public.kpi_targets
  ALTER COLUMN target_value TYPE numeric USING target_value::numeric;

ALTER TABLE public.kpi_targets ALTER COLUMN reward_amount DROP NOT NULL;
ALTER TABLE public.kpi_targets DROP CONSTRAINT IF EXISTS kpi_targets_reward_amount_check;
