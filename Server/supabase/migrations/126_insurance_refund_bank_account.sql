-- Insurance refunds paid by InstaPay / bank transfer leave from either the ADIB or the CIB account.
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS insurance_refund_bank_account varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reservations_insurance_refund_bank_account_check'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT reservations_insurance_refund_bank_account_check
      CHECK (insurance_refund_bank_account IS NULL OR insurance_refund_bank_account IN ('adib', 'cib'));
  END IF;
END $$;
