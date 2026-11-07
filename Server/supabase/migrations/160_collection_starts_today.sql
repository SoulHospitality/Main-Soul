-- Reservation collection starts fresh: every payment recorded before today (Cairo) is already checked
-- and collected. Only the review status changes; amounts, methods and treasury entries stay as they are.
UPDATE public.payments
SET finance_review_status = 'reviewed',
    finance_reviewed_at = now(),
    finance_review_note = COALESCE(finance_review_note, 'Checked before reservation collection started')
WHERE finance_review_status = 'pending'
  AND created_at < (date_trunc('day', now() AT TIME ZONE 'Africa/Cairo') AT TIME ZONE 'Africa/Cairo');
