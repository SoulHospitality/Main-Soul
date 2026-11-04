-- HR payroll rules built on the HR rules page (no code): WHEN → HOW MUCH → WHO, as a deduction or bonus.
-- The engine (src/lib/hrPayrollRules.js) writes one deduction/bonus row per rule per person per pay cycle.

CREATE TABLE IF NOT EXISTS public.hr_payroll_rules (
  id serial PRIMARY KEY,
  name text NOT NULL,
  effect text NOT NULL CHECK (effect IN ('deduction', 'bonus')),
  trigger text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount_type text NOT NULL CHECK (amount_type IN ('daily_rate', 'hourly_rate', 'fixed', 'percent_base')),
  amount numeric NOT NULL CHECK (amount > 0),
  roles text[] NOT NULL DEFAULT '{}',
  staff_ids integer[] NOT NULL DEFAULT '{}',
  free_count integer NOT NULL DEFAULT 0 CHECK (free_count >= 0),
  cap_amount numeric CHECK (cap_amount IS NULL OR cap_amount > 0),
  effective_from date,
  effective_to date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  sort_order integer NOT NULL DEFAULT 100,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Rows written by a rule carry the rule and the pay cycle ("2026-11") so a re-run can replace them.
ALTER TABLE public.staff_salary_deductions
  ADD COLUMN IF NOT EXISTS rule_id integer REFERENCES public.hr_payroll_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rule_period text;
ALTER TABLE public.staff_salary_bonuses
  ADD COLUMN IF NOT EXISTS rule_id integer REFERENCES public.hr_payroll_rules(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rule_period text;

CREATE INDEX IF NOT EXISTS staff_salary_deductions_rule_idx ON public.staff_salary_deductions (rule_period, rule_id);
CREATE INDEX IF NOT EXISTS staff_salary_bonuses_rule_idx ON public.staff_salary_bonuses (rule_period, rule_id);

-- The old "custom" deduction rules were only stored, never applied. Bring them over as inactive
-- drafts (a fixed daily-rate deduction every cycle) so HR can finish setting them up.
INSERT INTO public.hr_payroll_rules (name, effect, trigger, amount_type, amount, active, notes)
SELECT label, 'deduction', 'monthly_fixed', 'daily_rate', factor, false,
       'Moved from the old HR rules list. Choose when it applies and who it is for, then switch it on.'
FROM public.hr_deduction_rules
WHERE kind = 'custom' AND factor > 0;

DELETE FROM public.hr_deduction_rules WHERE kind = 'custom';
