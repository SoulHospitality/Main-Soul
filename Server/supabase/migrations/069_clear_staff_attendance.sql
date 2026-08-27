-- Empty the HR attendance schedule. Lateness/absence deductions created
-- from those days are removed so payroll/payslip no longer include them.
-- Loans, WFH, and other deduction categories are left intact.

DELETE FROM public.staff_salary_deductions
WHERE category IN ('lateness', 'absence');

DELETE FROM public.staff_attendance;
