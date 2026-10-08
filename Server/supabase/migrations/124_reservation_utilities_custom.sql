-- When true, reservations.utilities_amount is the exact utilities figure (0 included)
-- and the unit's default utilities_cost is never substituted.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS utilities_custom boolean NOT NULL DEFAULT false;

UPDATE public.reservations
   SET utilities_amount = utilities_cost_override * GREATEST(COALESCE(nights, 1), 1)
 WHERE utilities_cost_override > 0
   AND COALESCE(utilities_amount, 0) = 0;

UPDATE public.reservations
   SET utilities_custom = true
 WHERE utilities_custom = false
   AND (utilities_cost_override IS NOT NULL OR COALESCE(utilities_amount, 0) <> 0);
