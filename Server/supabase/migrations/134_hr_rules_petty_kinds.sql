-- HR can change deduction multipliers, and petty cash can flag loans, finance transfers, and ops cash.

CREATE TABLE IF NOT EXISTS public.hr_deduction_rules (
  id serial PRIMARY KEY,
  rule_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind = ANY (ARRAY['lateness'::text, 'absence'::text, 'unpaid_leave'::text, 'custom'::text])),
  label text NOT NULL,
  factor numeric NOT NULL DEFAULT 0,
  end_minutes integer,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.hr_deduction_rules (rule_key, kind, label, factor, end_minutes, sort_order)
VALUES
  ('lateness_grace', 'lateness', 'On time through 11:15', 0, 675, 1),
  ('lateness_quarter', 'lateness', '11:16–11:30', 0.25, 690, 2),
  ('lateness_half', 'lateness', '11:31–12:00', 0.5, 720, 3),
  ('lateness_full', 'lateness', 'After 12:00', 1, 1440, 4),
  ('absence', 'absence', 'No show', 2, NULL, 5),
  ('unpaid_leave', 'unpaid_leave', 'Unpaid leave', 1, NULL, 6)
ON CONFLICT (rule_key) DO NOTHING;

ALTER TABLE public.petty_cash
  ADD COLUMN IF NOT EXISTS entry_kind text NOT NULL DEFAULT 'standard';

ALTER TABLE public.petty_cash DROP CONSTRAINT IF EXISTS petty_cash_entry_kind_check;
ALTER TABLE public.petty_cash
  ADD CONSTRAINT petty_cash_entry_kind_check
  CHECK (entry_kind = ANY (ARRAY['standard'::text, 'loan'::text, 'finance_transfer'::text, 'ops_collection'::text]));
