-- Insurance refunds were already handled in ops before tracking existed.
-- Treat all stays with checkout before 2026-08-24 as fully settled (no damage).

UPDATE reservations
SET
  insurance_refund_status = 'refunded',
  insurance_refunded_amount = COALESCE(insurance, 0),
  insurance_damage_amount = 0,
  insurance_refunded_at = COALESCE(check_out, DATE '2026-08-23'),
  insurance_refund_method = 'historical',
  insurance_refund_notes = COALESCE(
    insurance_refund_notes,
    'Backfilled: settled before insurance refund tracking (checkout before 2026-08-24)'
  )
WHERE COALESCE(insurance, 0) > 0.009
  AND check_out IS NOT NULL
  AND check_out < DATE '2026-08-24'
  AND (
    insurance_refund_status IS NULL
    OR insurance_refund_status = 'pending'
    OR insurance_refund_status = ''
  );
