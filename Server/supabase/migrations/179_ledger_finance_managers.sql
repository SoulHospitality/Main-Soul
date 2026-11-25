-- 179: the people who may approve accounting policies, switch posting and the report source, and close or reopen
-- ledger months are the CEOs (role 'admin') AND the financial managers (role 'finance_manager'), by the owner's
-- decision of 2026-11-25 (segregation of duties, D-14). Every other rule stays: verified identity, an approver is
-- never the person who recorded the policy, every change logged. Replaces one function; changes no data.
CREATE OR REPLACE FUNCTION public.ledger_is_active_admin(staff_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE id = staff_id AND role IN ('admin', 'finance_manager')
                 AND COALESCE(is_active::text, '1') NOT IN ('0', 'false', 'f'))
$$;
