-- Rollback 179: approvals and switches go back to CEOs (role 'admin') only. Run BEFORE rollback_176.sql.
BEGIN;
CREATE OR REPLACE FUNCTION public.ledger_is_active_admin(staff_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE id = staff_id AND role = 'admin'
                 AND COALESCE(is_active::text, '1') NOT IN ('0', 'false', 'f'))
$$;
DELETE FROM public._schema_migrations WHERE id = '179_ledger_finance_managers.sql';
COMMIT;
