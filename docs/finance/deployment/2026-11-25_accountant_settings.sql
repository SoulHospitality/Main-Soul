-- The accountant's decisions of 2026-11-25 as settings. Run ONCE, by the DBA, at finance go-live
-- (docs/finance/FINANCE_GO_LIVE.md), in one transaction. Idempotent. Not a migration: it deliberately changes
-- business settings, so it is a recorded deployment step, not part of the automatic schema changes.
--   1. Books count from 25 November 2026 (Cairo midnight = 2026-11-24 22:00 UTC). Records created before it are
--      left out of the Financial System, exactly like the 12 November restart. Also set FINANCE_BOOKS_START=2026-11-25
--      on the Railway service.
--   2. VAT suspended from 25 November 2026 (no output or input VAT); earlier periods keep theirs.
--   3. Historical commissions settled (already paid): the commission review list is kept for reference only.
BEGIN;
SELECT key, value_text AS before FROM public.financial_settings
WHERE key IN ('books_reset_at', 'vat_suspended_from', 'commission_history_decision') ORDER BY key;

INSERT INTO public.financial_settings (key, value_text) VALUES ('books_reset_at', '2026-11-24T22:00:00Z')
ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text;
INSERT INTO public.financial_settings (key, value_text) VALUES ('vat_suspended_from', '2026-11-25')
ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text;
INSERT INTO public.financial_settings (key, value_text) VALUES ('commission_history_decision', 'settled:2026-11-25:accountant')
ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text;

SELECT key, value_text AS after FROM public.financial_settings
WHERE key IN ('books_reset_at', 'vat_suspended_from', 'commission_history_decision') ORDER BY key;
COMMIT;
