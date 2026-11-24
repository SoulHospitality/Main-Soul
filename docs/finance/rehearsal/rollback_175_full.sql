-- Rollback 175 (full): removes everything migration 175 added, INCLUDING saved snapshots and the
-- correction log. Use only on a restored copy, or in production before any real confirmation was
-- captured, or after exporting both (see README). Requires an explicit confirmation:
--   SET app.confirm_rollback_175 = 'drop-commission-snapshots';
-- ORDER IN PRODUCTION: first redeploy an app build that does not contain 175_commission_snapshots.sql,
-- then run this. (Otherwise the app re-applies 175 on its next start, because the record below is removed.)
BEGIN;
DO $$ BEGIN
  IF COALESCE(current_setting('app.confirm_rollback_175', true), '') <> 'drop-commission-snapshots' THEN
    RAISE EXCEPTION 'Refusing: set app.confirm_rollback_175 to confirm that snapshots and corrections will be deleted';
  END IF;
END $$;
DROP VIEW IF EXISTS public.reservation_commission_review;
DROP TRIGGER IF EXISTS reservations_commission_snapshot ON public.reservations;
DROP FUNCTION IF EXISTS public.reservation_commission_snapshot();
DROP TABLE IF EXISTS public.reservation_commission_corrections;
DROP FUNCTION IF EXISTS public.reservation_commission_corrections_append_only();
ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_commission_snapshot_status_check;
ALTER TABLE public.reservations
  DROP COLUMN IF EXISTS commission_snapshot,
  DROP COLUMN IF EXISTS commission_snapshot_at,
  DROP COLUMN IF EXISTS commission_snapshot_status,
  DROP COLUMN IF EXISTS commission_review_reason;
DELETE FROM public.financial_settings WHERE key = 'commission_snapshots_since';
DELETE FROM public._schema_migrations WHERE id = '175_commission_snapshots.sql';
SELECT 'migration 175 removed' AS result;
COMMIT;
