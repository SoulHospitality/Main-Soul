-- Automatic clock-out at the end of the shift for staff who forgot to clock out.
ALTER TABLE public.staff_clock_events DROP CONSTRAINT IF EXISTS staff_clock_events_source_check;
ALTER TABLE public.staff_clock_events
  ADD CONSTRAINT staff_clock_events_source_check
  CHECK (source = ANY (ARRAY['biometric'::text, 'left_area'::text, 'hr'::text, 'shift_end'::text]));

-- Leaving before the shift ends without an approved excuse is deducted (hours missed × hourly rate).
ALTER TABLE public.staff_salary_deductions DROP CONSTRAINT IF EXISTS staff_salary_deductions_category_check;
ALTER TABLE public.staff_salary_deductions
  ADD CONSTRAINT staff_salary_deductions_category_check
  CHECK (category = ANY (ARRAY[
    'lateness','absence','delay','performance','advance','other','loan','wfh','penalty','early_leave'
  ]));
