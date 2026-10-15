-- KPI targets. Progress pays a matching share of the reward, once the minimum is met.

CREATE TABLE IF NOT EXISTS public.kpi_targets (
  id serial PRIMARY KEY,
  metric text NOT NULL CHECK (metric = ANY (ARRAY['reservations', 'check_ins', 'check_outs'])),
  target_value integer NOT NULL CHECK (target_value > 0),
  reward_amount real NOT NULL CHECK (reward_amount > 0),
  min_percent real NOT NULL DEFAULT 0 CHECK (min_percent >= 0 AND min_percent <= 100),
  starts_on date NOT NULL,
  deadline date NOT NULL,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (deadline >= starts_on)
);

CREATE TABLE IF NOT EXISTS public.kpi_target_assignees (
  id serial PRIMARY KEY,
  target_id integer NOT NULL REFERENCES public.kpi_targets(id) ON DELETE CASCADE,
  staff_user_id integer NOT NULL REFERENCES public.staff_users(id) ON DELETE CASCADE,
  applied_bonus_id integer REFERENCES public.staff_salary_bonuses(id) ON DELETE SET NULL,
  applied_at timestamptz,
  applied_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  UNIQUE (target_id, staff_user_id)
);

CREATE INDEX IF NOT EXISTS kpi_targets_deadline_idx ON public.kpi_targets (deadline DESC);
CREATE INDEX IF NOT EXISTS kpi_target_assignees_staff_idx ON public.kpi_target_assignees (staff_user_id);
