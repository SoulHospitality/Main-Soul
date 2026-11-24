-- Rollback 175 (soft, preferred): stop capturing commission snapshots. Keeps every saved snapshot and
-- correction; nothing is deleted. Existing app code does not read these columns, so it is unaffected.
-- Safe to run in production in an incident (with approval). Re-enable by re-creating the trigger
-- (the CREATE TRIGGER statement at the end of 175_commission_snapshots.sql).
BEGIN;
DROP TRIGGER IF EXISTS reservations_commission_snapshot ON public.reservations;
SELECT 'snapshot capture stopped; ' || COUNT(*) || ' saved snapshots kept' AS result
FROM public.reservations WHERE commission_snapshot IS NOT NULL;
COMMIT;
