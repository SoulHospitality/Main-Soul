-- 1. Every insurance from a stay that has already checked out is marked as paid back to the guest.
--    Method 'historical' releases the escrow against retained earnings, so no treasury balance changes.
UPDATE public.reservations
SET insurance_refund_status = 'refunded',
    insurance_refunded_amount = insurance,
    insurance_damage_amount = 0,
    insurance_refund_method = 'historical',
    insurance_refunded_at = check_out::date,
    insurance_refund_notes = COALESCE(insurance_refund_notes || E'\n', '') || 'Marked paid (historical, no treasury change)',
    updated_at = now()
WHERE COALESCE(insurance, 0) > 0.009
  AND lower(COALESCE(status::text, '')) <> 'cancelled'
  AND lower(COALESCE(insurance_refund_status, 'pending')) NOT IN ('refunded', 'partial', 'forfeited')
  AND check_out::date <= (now() AT TIME ZONE 'Africa/Cairo')::date;

-- 2. Subscriptions (601000), Office Rent (604000) and Operational Rents (612000) are removed;
--    their entries move to Fixed Monthly Charges (613000). The office rent monthly charge goes with them.
DO $$
BEGIN
  IF to_regclass('public.financial_manual_entries') IS NOT NULL THEN
    UPDATE public.financial_manual_entries SET debit_account_code = '613000'
      WHERE debit_account_code IN ('601000', '604000', '612000');
    UPDATE public.financial_manual_entries SET credit_account_code = '613000'
      WHERE credit_account_code IN ('601000', '604000', '612000');
  END IF;
  IF to_regclass('public.finance_calendar_payments') IS NOT NULL THEN
    UPDATE public.finance_calendar_payments SET account_code = '613000'
      WHERE account_code IN ('601000', '604000', '612000');
  END IF;
  IF to_regclass('public.financial_custom_accounts') IS NOT NULL THEN
    UPDATE public.financial_custom_accounts SET parent_code = '613000'
      WHERE parent_code IN ('601000', '604000', '612000');
  END IF;
  IF to_regclass('public.financial_recurring_charges') IS NOT NULL THEN
    DELETE FROM public.financial_recurring_charges WHERE kind = 'rent';
  END IF;
END $$;

-- 3. Developers, chosen on manual entries that use the Developer expense account (619000).
CREATE TABLE IF NOT EXISTS public.financial_developers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_developers_name_nonempty CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_developers_name_uidx ON public.financial_developers (lower(btrim(name)));

ALTER TABLE public.financial_manual_entries
  ADD COLUMN IF NOT EXISTS developer_id integer REFERENCES public.financial_developers(id) ON DELETE RESTRICT;

-- 4. Calendar payments through a bank can be made by cheque (number and photo required).
ALTER TABLE public.finance_calendar_payments
  ADD COLUMN IF NOT EXISTS payment_mode varchar(12) NOT NULL DEFAULT 'transfer',
  ADD COLUMN IF NOT EXISTS cheque_number varchar(64),
  ADD COLUMN IF NOT EXISTS cheque_photo_url text;

ALTER TABLE public.finance_calendar_payments DROP CONSTRAINT IF EXISTS finance_calendar_payments_mode_check;
ALTER TABLE public.finance_calendar_payments
  ADD CONSTRAINT finance_calendar_payments_mode_check CHECK (payment_mode IN ('transfer', 'cheque'));

-- 5. Refunds and insurance payouts can name the exact treasury (or petty cash) account they leave from.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS treasury_account_code varchar(16);
ALTER TABLE public.reservations ADD COLUMN IF NOT EXISTS insurance_refund_treasury_code varchar(16);

-- 6. Cancellations with money collected wait for finance to approve the refund.
CREATE TABLE IF NOT EXISTS public.reservation_cancel_requests (
  id serial PRIMARY KEY,
  reservation_id integer NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  status varchar(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  reason text,
  requested_choice varchar(20),
  requested_refund numeric(14, 2) NOT NULL DEFAULT 0,
  collected numeric(14, 2) NOT NULL DEFAULT 0,
  requested_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  refund_amount numeric(14, 2),
  treasury_account_code varchar(16),
  refund_date date,
  payment_id integer REFERENCES public.payments(id) ON DELETE SET NULL,
  decided_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_note text
);
CREATE INDEX IF NOT EXISTS reservation_cancel_requests_status_idx ON public.reservation_cancel_requests (status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS reservation_cancel_requests_open_uidx
  ON public.reservation_cancel_requests (reservation_id) WHERE status = 'pending';

-- 7. Each petty cash drawer is its own sub-account under 108000 Petty Cash (Assets).
ALTER TABLE public.petty_cash_accounts ADD COLUMN IF NOT EXISTS account_code varchar(12);

DO $$
DECLARE
  acct record;
  n integer;
  next_code text;
BEGIN
  IF to_regclass('public.petty_cash_accounts') IS NULL OR to_regclass('public.financial_custom_accounts') IS NULL THEN
    RETURN;
  END IF;
  FOR acct IN SELECT id, name FROM public.petty_cash_accounts WHERE account_code IS NULL ORDER BY id LOOP
    n := 1;
    LOOP
      next_code := '108' || lpad(n::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.financial_custom_accounts WHERE code = next_code)
        AND NOT EXISTS (SELECT 1 FROM public.petty_cash_accounts WHERE account_code = next_code);
      n := n + 1;
    END LOOP;
    INSERT INTO public.financial_custom_accounts (code, name, account_group, parent_code)
    VALUES (next_code, 'Petty Cash - ' || acct.name, 'assets', '108000');
    UPDATE public.petty_cash_accounts SET account_code = next_code WHERE id = acct.id;
  END LOOP;
END $$;
