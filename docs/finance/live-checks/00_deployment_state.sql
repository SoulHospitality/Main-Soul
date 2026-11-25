-- Check 0: is production still on the existing implementation? Read-only. No personal data.
-- Expected before deployment: last migration 174_…, and every other line false / 0.
BEGIN TRANSACTION READ ONLY;

SELECT 'last applied migration' AS item, (SELECT MAX(id) FROM public._schema_migrations) AS value
UNION ALL SELECT '175-178 applied', (SELECT COUNT(*)::text FROM public._schema_migrations WHERE id >= '175')
UNION ALL SELECT 'reservations.commission_snapshot column exists',
  (SELECT (COUNT(*) > 0)::text FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reservations' AND column_name = 'commission_snapshot')
UNION ALL SELECT 'ledger tables exist',
  (SELECT COUNT(*)::text FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'ledger\_%')
UNION ALL SELECT 'ledger_posting setting exists',
  (SELECT COUNT(*)::text FROM public.financial_settings WHERE key = 'ledger_posting')
UNION ALL SELECT 'ledger_reports setting exists',
  (SELECT COUNT(*)::text FROM public.financial_settings WHERE key = 'ledger_reports');

ROLLBACK;
