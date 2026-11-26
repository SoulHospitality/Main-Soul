-- 180: each staff member has their own shift (start and end), and is paid either by shifts and attendance
-- (lateness, early leave and no-shows against their own shift) or by hours per week (no attendance
-- deductions; each hour short of the weekly hours costs 2 × hourly rate, hourly rate = daily rate ÷ 8).
-- Everyone keeps today's behaviour: shift 11:00–19:00, paid by shifts and attendance.
ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS shift_start time NOT NULL DEFAULT '11:00';
ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS shift_end time NOT NULL DEFAULT '19:00';
ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS pay_basis text NOT NULL DEFAULT 'shift';
ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS weekly_hours numeric(5, 2);
-- The first day the weekly hours count from (set when someone is switched to hours per week), so weeks
-- before the switch are never deducted and the first week is pro-rated.
ALTER TABLE public.staff_users ADD COLUMN IF NOT EXISTS weekly_hours_since date;

ALTER TABLE public.staff_users DROP CONSTRAINT IF EXISTS staff_users_pay_basis_check;
ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_pay_basis_check CHECK (pay_basis = ANY (ARRAY['shift'::text, 'weekly_hours'::text]));
ALTER TABLE public.staff_users DROP CONSTRAINT IF EXISTS staff_users_shift_order_check;
ALTER TABLE public.staff_users ADD CONSTRAINT staff_users_shift_order_check CHECK (shift_end > shift_start);
ALTER TABLE public.staff_users DROP CONSTRAINT IF EXISTS staff_users_weekly_hours_check;
ALTER TABLE public.staff_users
  ADD CONSTRAINT staff_users_weekly_hours_check CHECK (
    pay_basis <> 'weekly_hours' OR (weekly_hours IS NOT NULL AND weekly_hours > 0 AND weekly_hours <= 84)
  );

-- The weekly shortfall deduction.
ALTER TABLE public.staff_salary_deductions DROP CONSTRAINT IF EXISTS staff_salary_deductions_category_check;
ALTER TABLE public.staff_salary_deductions
  ADD CONSTRAINT staff_salary_deductions_category_check
  CHECK (category = ANY (ARRAY[
    'lateness','absence','delay','performance','advance','other','loan','wfh','penalty','early_leave','weekly_hours'
  ]));
