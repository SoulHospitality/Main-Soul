-- Rehearsal r2: migrations 175 and 176 are in place and inert. READ-ONLY. Every row must say passed = true.
BEGIN TRANSACTION READ ONLY;

WITH c(check_name, passed, detail) AS (
  SELECT '175 recorded as applied', EXISTS (SELECT 1 FROM public._schema_migrations WHERE id = '175_commission_snapshots.sql'), NULL::text
  UNION ALL SELECT '176 recorded as applied', EXISTS (SELECT 1 FROM public._schema_migrations WHERE id = '176_ledger_core.sql'), NULL
  UNION ALL SELECT 'reservation snapshot columns exist',
    (SELECT COUNT(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'reservations'
       AND column_name IN ('commission_snapshot', 'commission_snapshot_at', 'commission_snapshot_status', 'commission_review_reason')), NULL
  UNION ALL SELECT 'snapshot trigger enabled',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reservations_commission_snapshot' AND tgenabled <> 'D'), NULL
  UNION ALL SELECT 'correction log is append-only (trigger present)',
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'reservation_commission_corrections_append_only'), NULL
  UNION ALL SELECT 'no existing reservation was given a snapshot by the migration',
    NOT EXISTS (SELECT 1 FROM public.reservations r, public.financial_settings s
                WHERE s.key = 'commission_snapshots_since' AND r.commission_snapshot IS NOT NULL
                  AND r.commission_snapshot_at < s.value_text::timestamptz),
    (SELECT COUNT(*) || ' snapshots in total' FROM public.reservations WHERE commission_snapshot IS NOT NULL)
  UNION ALL SELECT 'historical confirmed stays listed for review',
    (SELECT COUNT(*) FROM public.reservation_commission_review) >=
    (SELECT COUNT(*) FROM public.reservations WHERE status IN ('confirmed', 'checked_in', 'checked_out') AND commission_snapshot IS NULL),
    (SELECT COUNT(*) || ' stays on the review list' FROM public.reservation_commission_review)
  UNION ALL SELECT 'ledger tables exist',
    (SELECT COUNT(*) = 6 FROM information_schema.tables WHERE table_schema = 'public'
       AND table_name IN ('ledger_accounts', 'ledger_policies', 'ledger_periods', 'ledger_entries', 'ledger_lines', 'ledger_events')), NULL
  UNION ALL SELECT 'chart seeded: 47 system accounts',
    (SELECT COUNT(*) = 47 FROM public.ledger_accounts WHERE is_system), (SELECT COUNT(*)::text FROM public.ledger_accounts WHERE is_system)
  UNION ALL SELECT 'every custom account copied into the ledger chart',
    NOT EXISTS (SELECT 1 FROM public.financial_custom_accounts c LEFT JOIN public.ledger_accounts l ON l.code = c.code WHERE l.code IS NULL),
    (SELECT COUNT(*) || ' custom accounts' FROM public.financial_custom_accounts)
  UNION ALL SELECT 'ledger is empty', (SELECT COUNT(*) = 0 FROM public.ledger_entries) AND (SELECT COUNT(*) = 0 FROM public.ledger_lines), NULL
  UNION ALL SELECT 'no approved accounting policy exists', NOT EXISTS (SELECT 1 FROM public.ledger_policies WHERE status = 'approved'), NULL
  UNION ALL SELECT 'posting switch is off',
    (SELECT value_text FROM public.financial_settings WHERE key = 'ledger_posting') = 'off', NULL
  UNION ALL SELECT 'database posting guards present',
    (SELECT COUNT(*) = 6 FROM pg_trigger WHERE tgname IN ('ledger_entries_insert_guard', 'ledger_lines_insert_guard',
       'ledger_entries_guard', 'ledger_lines_guard', 'ledger_entry_balance_check', 'ledger_policies_guard')), NULL
)
SELECT check_name, passed, detail FROM c;

ROLLBACK;
