-- Rehearsal r1: fingerprint of existing data. READ-ONLY. Run before the migrations, after them, and after
-- each rollback; every line except `migrations` (and `settings`, see below) must be identical between runs.
-- Output is counts and md5 hashes only: no personal data. Rehearsal test rows are excluded.
BEGIN TRANSACTION READ ONLY;

SELECT 'migrations >= 170' AS item,
       COALESCE(string_agg(id, ', ' ORDER BY id), '(none)') AS fingerprint
FROM public._schema_migrations WHERE id >= '170'
UNION ALL
SELECT 'reservations', COUNT(*) || ' rows / ' || md5(COALESCE(string_agg(
         (to_jsonb(r) - 'commission_snapshot' - 'commission_snapshot_at' - 'commission_snapshot_status' - 'commission_review_reason')::text,
         '|' ORDER BY r.id), ''))
FROM public.reservations r WHERE r.guest_name IS DISTINCT FROM 'REHEARSAL TEST'
UNION ALL
SELECT 'payments', COUNT(*) || ' rows / ' || md5(COALESCE(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), ''))
FROM public.payments p
UNION ALL
SELECT 'expenses', COUNT(*) || ' rows / ' || md5(COALESCE(string_agg(to_jsonb(e)::text, '|' ORDER BY e.id), ''))
FROM public.expenses e
UNION ALL
SELECT 'cash_ledger', COUNT(*) || ' rows / ' || md5(COALESCE(string_agg(to_jsonb(c)::text, '|' ORDER BY c.id), ''))
FROM public.cash_ledger c
UNION ALL
SELECT 'financial_posted_entries (closed months)', COUNT(*) || ' rows / ' || md5(COALESCE(string_agg(to_jsonb(f)::text, '|' ORDER BY f.year_month, f.kind, f.entry_id), ''))
FROM public.financial_posted_entries f
UNION ALL
SELECT 'financial_custom_accounts', COUNT(*) || ' rows / ' || md5(COALESCE(string_agg(to_jsonb(a)::text, '|' ORDER BY a.code), ''))
FROM public.financial_custom_accounts a
UNION ALL
SELECT 'unit commission rates', COUNT(*) || ' units / ' || md5(COALESCE(string_agg(
         concat_ws(',', u.id, u.commission_mode, u.company_commission_pct, u.company_commission_owner_pct, u.commission_tenant_pct), '|' ORDER BY u.id::text), ''))
FROM public.units u WHERE u.slug NOT LIKE 'rehearsal-%'
UNION ALL
SELECT 'salesperson rates', COUNT(*) || ' staff / ' || md5(COALESCE(string_agg(concat_ws(',', s.id, s.sales_commission_pct), '|' ORDER BY s.id), ''))
FROM public.staff_users s WHERE s.username NOT LIKE 'rehearsal_%'
UNION ALL
-- The migrations add two settings (ledger_posting, commission_snapshots_since); they are excluded here.
SELECT 'settings', COUNT(*) || ' rows / ' || md5(COALESCE(string_agg(to_jsonb(fs)::text, '|' ORDER BY fs.key), ''))
FROM public.financial_settings fs WHERE fs.key NOT IN ('ledger_posting', 'commission_snapshots_since');

ROLLBACK;
