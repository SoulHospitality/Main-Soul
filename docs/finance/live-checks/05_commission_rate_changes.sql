-- Check 5: units whose commission % changed, and confirmed stays that predate the change. Read-only.
-- Uses the audit trail of unit edits (action UPDATE_UNIT, field-level changes). No personal data.
BEGIN TRANSACTION READ ONLY;

WITH changes AS (
  SELECT a.entity_id AS unit_id, a.created_at AS changed_at,
         a.details -> 'changes' -> 'company_commission_pct' AS company_pct_change,
         a.details -> 'changes' -> 'company_commission_owner_pct' AS owner_pct_change
  FROM public.audit_log a
  WHERE a.action = 'UPDATE_UNIT' AND a.entity_type = 'unit'
    AND (a.details -> 'changes' ? 'company_commission_pct' OR a.details -> 'changes' ? 'company_commission_owner_pct')
)
SELECT c.unit_id, c.changed_at, c.company_pct_change, c.owner_pct_change,
       (SELECT COUNT(*) FROM public.reservations r
         WHERE r.unit_id::text = c.unit_id AND r.status IN ('confirmed', 'checked_in', 'checked_out')
           AND r.created_at < c.changed_at) AS confirmed_stays_before_change
FROM changes c
ORDER BY c.changed_at DESC;

-- Salesperson % changes are not field-audited today, so they cannot be dated from the database.
-- All confirmed stays with a salesperson are therefore "rate unknown" until reviewed:
SELECT COUNT(*) AS confirmed_stays_with_salesperson
FROM public.reservations r
WHERE r.status IN ('confirmed', 'checked_in', 'checked_out') AND r.sales_person_id IS NOT NULL;

ROLLBACK;
