-- Owner payouts: where to send the money, the owner's note, the payment reference, and owner cancellation.
ALTER TABLE public.owner_payout_requests ADD COLUMN IF NOT EXISTS payout_method text;
ALTER TABLE public.owner_payout_requests ADD COLUMN IF NOT EXISTS payout_details jsonb;
ALTER TABLE public.owner_payout_requests ADD COLUMN IF NOT EXISTS owner_note text;
ALTER TABLE public.owner_payout_requests ADD COLUMN IF NOT EXISTS payment_reference text;
ALTER TABLE public.owner_payout_requests ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.owner_payout_requests ADD COLUMN IF NOT EXISTS paid_by integer REFERENCES public.staff_users(id);

ALTER TABLE public.owner_payout_requests DROP CONSTRAINT IF EXISTS owner_payout_requests_status_check;
ALTER TABLE public.owner_payout_requests
  ADD CONSTRAINT owner_payout_requests_status_check
  CHECK (status = ANY (ARRAY['requested', 'approved', 'rejected', 'paid', 'cancelled']));

-- Paid payouts from before: the review time was the payment time.
UPDATE public.owner_payout_requests SET paid_at = COALESCE(reviewed_at, updated_at, created_at)
WHERE status = 'paid' AND paid_at IS NULL;

-- Where each owner wants to be paid, saved once and copied onto every request.
CREATE TABLE IF NOT EXISTS public.owner_payout_details (
  owner_id integer PRIMARY KEY REFERENCES public.staff_users(id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'bank_transfer' CHECK (method IN ('bank_transfer', 'instapay', 'cash')),
  bank_name text,
  account_name text,
  account_number text,
  iban text,
  instapay text,
  phone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
