-- Broker phone on reservations, and an "other" payment method that requires a note.

ALTER TABLE public.reservations
  ADD COLUMN IF NOT EXISTS broker_phone varchar(50),
  ADD COLUMN IF NOT EXISTS payment_method_note text;

ALTER TABLE public.reservations DROP CONSTRAINT IF EXISTS reservations_payment_method_check;
ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_payment_method_check
  CHECK (
    payment_method IS NULL
    OR payment_method = ANY (ARRAY[
      'cash','instapay','bank_transfer','credit_card','online','paymob_card','other'
    ])
  );

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_method_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_method_check
  CHECK (payment_method = ANY (ARRAY[
    'cash','bank_transfer','credit_card','online','paymob_card','instapay','other'
  ]));
