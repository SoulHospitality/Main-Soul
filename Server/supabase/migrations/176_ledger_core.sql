-- Phase 2 foundation: a stored, immutable double-entry ledger, created EMPTY.
-- Nothing posts to it yet: historical import and live posting stay blocked until decision D-01
-- (principal vs agent) is approved in writing by the company's accountant. The current computed books
-- (lib/finance/ledgerEngine.js) remain the reference and the source of every report.
-- Additive only: no existing table or row is changed.

-- Chart of accounts: seeded from lib/finance/chartOfAccounts.js (same codes) and the user-defined accounts.
CREATE TABLE IF NOT EXISTS public.ledger_accounts (
  code           varchar(12) PRIMARY KEY,
  name           text NOT NULL,
  account_type   text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'cost_of_revenue', 'expense')),
  subtype        text,
  parent_code    varchar(12) REFERENCES public.ledger_accounts(code),
  normal_balance text NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  currency       char(3),                    -- NULL = any currency
  is_system      boolean NOT NULL DEFAULT false,
  active         boolean NOT NULL DEFAULT true,
  description    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.ledger_accounts (code, name, account_type, subtype, normal_balance, currency, is_system) VALUES
  ('101000', 'Bank - ADIB (EGP)', 'asset', 'bank', 'debit', 'EGP', true),
  ('102000', 'Bank - CIB (EGP)', 'asset', 'bank', 'debit', 'EGP', true),
  ('103000', 'Cash - EGP', 'asset', 'cash', 'debit', 'EGP', true),
  ('104000', 'Cash - USD (booked in EGP)', 'asset', 'cash', 'debit', 'USD', true),
  ('108000', 'Petty Cash', 'asset', NULL, 'debit', NULL, true),
  ('105000', 'Guest Accounts Receivable', 'asset', NULL, 'debit', NULL, true),
  ('106000', 'Payment Gateway Clearing (Paymob / Stripe / Fawry)', 'asset', NULL, 'debit', NULL, true),
  ('107000', 'VAT Receivable (Input VAT 14%)', 'asset', NULL, 'debit', NULL, true),
  ('105900', 'Allowance for Doubtful Accounts (reduces guest receivable)', 'asset', 'contra', 'credit', NULL, true),
  ('110000', 'Accrued Owner Recoverables (Utilities & Maintenance)', 'asset', NULL, 'debit', NULL, true),
  ('111000', 'Deferred Owner Share (nights not yet stayed)', 'asset', NULL, 'debit', NULL, true),
  ('201000', 'Vendor Accounts Payable', 'liability', NULL, 'credit', NULL, true),
  ('202000', 'Owner Accounts Payable (Funds Held in Trust)', 'liability', NULL, 'credit', NULL, true),
  ('203000', 'Guest Advance Deposits (Unearned Revenue)', 'liability', NULL, 'credit', NULL, true),
  ('204000', 'Guest Insurance Payable (Refundable Escrow)', 'liability', NULL, 'credit', NULL, true),
  ('205000', 'Tax / VAT Payable (14% Egyptian VAT)', 'liability', NULL, 'credit', NULL, true),
  ('206000', 'Withholding Tax Payable (WHT - Egyptian Tax Authority)', 'liability', NULL, 'credit', NULL, true),
  ('208000', 'Broker Accounts Payable', 'liability', NULL, 'credit', NULL, true),
  ('209000', 'Sales Agent Commission Payable', 'liability', NULL, 'credit', NULL, true),
  ('210000', 'Deferred Stay Revenue (nights not yet stayed)', 'liability', NULL, 'credit', NULL, true),
  ('302000', 'Retained Earnings', 'equity', NULL, 'credit', NULL, true),
  ('303000', 'Current Year Profit / Loss', 'equity', NULL, 'credit', NULL, true),
  ('401000', 'Management Fee / Commission Revenue (Agent Split)', 'revenue', NULL, 'credit', NULL, true),
  ('402000', 'Cleaning & Turnover Fee Revenue', 'revenue', NULL, 'credit', NULL, true),
  ('403000', 'Maintenance Markup & Service Fee Revenue', 'revenue', NULL, 'credit', NULL, true),
  ('404000', 'Direct Rental Revenue (Owned / Master-Leased)', 'revenue', NULL, 'credit', NULL, true),
  ('409000', 'Miscellaneous Guest Revenue (Early Check-in, Extra Amenities)', 'revenue', NULL, 'credit', NULL, true),
  ('410000', 'Insurance Damage Retention Revenue', 'revenue', NULL, 'credit', NULL, true),
  ('501000', 'Housekeeping salaries', 'expense', NULL, 'debit', NULL, true),
  ('504000', 'Merchant / Payment Gateway Transaction Fees', 'expense', NULL, 'debit', NULL, true),
  ('506000', 'Owner Share Expense (Unit % of nightly rate × nights)', 'expense', 'owner_share', 'debit', NULL, true),
  ('508000', 'Staff Buffet & Meals', 'expense', NULL, 'debit', NULL, true),
  ('602000', 'Salaries (Campus)', 'expense', NULL, 'debit', NULL, true),
  ('603000', 'Marketing', 'expense', NULL, 'debit', NULL, true),
  ('605000', 'General & Administrations Expenses', 'expense', NULL, 'debit', NULL, true),
  ('608000', 'Campus Utilities', 'expense', NULL, 'debit', NULL, true),
  ('609000', 'Sales Agent Commission Expense', 'expense', NULL, 'debit', NULL, true),
  ('610000', 'Charity (Sadaqat)', 'expense', NULL, 'debit', NULL, true),
  ('611000', 'Vodafone Bill', 'expense', NULL, 'debit', NULL, true),
  ('613000', 'Fixed Monthly Charges', 'expense', NULL, 'debit', NULL, true),
  ('614000', 'Legal & Accounting Office Fees', 'expense', NULL, 'debit', NULL, true),
  ('615000', 'Tax / VAT (14% Egyptian VAT)', 'expense', NULL, 'debit', NULL, true),
  ('616000', 'Laundry', 'expense', NULL, 'debit', NULL, true),
  ('617000', 'Uniform', 'expense', NULL, 'debit', NULL, true),
  ('618000', 'Stock', 'expense', NULL, 'debit', NULL, true),
  ('619000', 'Developer', 'expense', NULL, 'debit', NULL, true),
  ('620000', 'Bad Debt Expense (write-offs & expected credit loss)', 'expense', NULL, 'debit', NULL, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_accounts (code, name, account_type, normal_balance)
SELECT c.code, c.name,
       CASE c.account_group WHEN 'assets' THEN 'asset' WHEN 'liabilities' THEN 'liability' WHEN 'equity' THEN 'equity'
                            WHEN 'revenue' THEN 'revenue' ELSE 'expense' END,
       CASE WHEN c.account_group IN ('assets', 'expenses') THEN 'debit' ELSE 'credit' END
FROM public.financial_custom_accounts c
ON CONFLICT (code) DO NOTHING;
UPDATE public.ledger_accounts l SET parent_code = c.parent_code
FROM public.financial_custom_accounts c
WHERE l.code = c.code AND c.parent_code IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.ledger_accounts p WHERE p.code = c.parent_code);

-- Accounting policies, versioned. D-01 (gross/net per unit or contract) is configured here once the
-- accountant approves it in writing; entries record which policy version produced them.
CREATE TABLE IF NOT EXISTS public.ledger_policies (
  version        text PRIMARY KEY,
  effective_from date NOT NULL,
  settings       jsonb NOT NULL,
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  -- Decision 1: revenue presentation under EAS 48 (D-01).
  approved_by    integer,
  approved_at    timestamptz,
  approval_ref   text,
  -- Decision 2: VAT base (D-11), a separate written approval.
  vat_approved_by  integer,
  vat_approved_at  timestamptz,
  vat_approval_ref text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR (
    approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_ref IS NOT NULL
    AND vat_approved_by IS NOT NULL AND vat_approved_at IS NOT NULL AND vat_approval_ref IS NOT NULL
    AND settings ? 'revenue_presentation' AND settings ? 'vat_base'))
);

-- An approved policy is a permanent record: it can only be retired, never edited or deleted.
CREATE OR REPLACE FUNCTION public.ledger_policies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Accounting policy % has been approved and cannot be deleted', OLD.version;
  END IF;
  IF OLD.status = 'draft' THEN RETURN NEW; END IF;
  IF OLD.status = 'approved' AND NEW.status = 'retired'
     AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Accounting policy % is % and cannot be changed; create a new version', OLD.version, OLD.status;
END $$;
DROP TRIGGER IF EXISTS ledger_policies_guard ON public.ledger_policies;
CREATE TRIGGER ledger_policies_guard BEFORE UPDATE OR DELETE ON public.ledger_policies
  FOR EACH ROW EXECUTE FUNCTION public.ledger_policies_guard();

CREATE TABLE IF NOT EXISTS public.ledger_periods (
  period        char(7) PRIMARY KEY,           -- YYYY-MM
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closing', 'closed')),
  closed_by     integer,
  closed_at     timestamptz,
  reopened_by   integer,
  reopened_at   timestamptz,
  reopen_reason text
);

CREATE SEQUENCE IF NOT EXISTS public.ledger_entry_number_seq;

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id               bigserial PRIMARY KEY,
  number           text NOT NULL UNIQUE,      -- JE-YYYY-000001
  transaction_date date NOT NULL,
  posting_date     date NOT NULL DEFAULT ((now() AT TIME ZONE 'Africa/Cairo')::date),
  period           char(7) NOT NULL,
  description      text NOT NULL,
  source_module    text NOT NULL,
  source_type      text NOT NULL,
  source_id        text NOT NULL,
  source_version   integer NOT NULL DEFAULT 1,
  origin           text NOT NULL CHECK (origin IN ('system', 'manual', 'migrated', 'adjustment', 'reversal')),
  status           text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  reverses_id      bigint REFERENCES public.ledger_entries(id),
  reversed_by_id   bigint REFERENCES public.ledger_entries(id),
  idempotency_key  text NOT NULL UNIQUE,
  policy_version   text REFERENCES public.ledger_policies(version),
  created_by       integer,
  approved_by      integer,
  created_txid     bigint NOT NULL DEFAULT txid_current(),  -- set by the insert guard; lines must join in the same transaction
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_entries_source_idx ON public.ledger_entries (source_type, source_id);
CREATE INDEX IF NOT EXISTS ledger_entries_period_idx ON public.ledger_entries (period);

CREATE TABLE IF NOT EXISTS public.ledger_lines (
  id             bigserial PRIMARY KEY,
  entry_id       bigint NOT NULL REFERENCES public.ledger_entries(id),
  line_no        integer NOT NULL,
  account_code   varchar(12) NOT NULL REFERENCES public.ledger_accounts(code),
  debit          numeric(19,4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         numeric(19,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency       char(3) NOT NULL DEFAULT 'EGP',
  fx_rate        numeric(18,8) NOT NULL DEFAULT 1 CHECK (fx_rate > 0),
  base_debit     numeric(19,4) NOT NULL DEFAULT 0 CHECK (base_debit >= 0),
  base_credit    numeric(19,4) NOT NULL DEFAULT 0 CHECK (base_credit >= 0),
  memo           text,
  unit_id        uuid,
  project        text,
  reservation_id integer,
  owner_id       integer,
  employee_id    integer,
  vendor_id      integer,
  tax_code       text,
  CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  UNIQUE (entry_id, line_no)
);
CREATE INDEX IF NOT EXISTS ledger_lines_account_idx ON public.ledger_lines (account_code);
CREATE INDEX IF NOT EXISTS ledger_lines_reservation_idx ON public.ledger_lines (reservation_id) WHERE reservation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ledger_lines_unit_idx ON public.ledger_lines (unit_id) WHERE unit_id IS NOT NULL;

-- Outbox: operational changes become events; the posting service turns them into entries.
CREATE TABLE IF NOT EXISTS public.ledger_events (
  id              bigserial PRIMARY KEY,
  event_type      text NOT NULL,
  source_type     text NOT NULL,
  source_id       text NOT NULL,
  source_version  integer NOT NULL DEFAULT 1,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed', 'skipped', 'held')),
  error           text,
  entry_id        bigint REFERENCES public.ledger_entries(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS ledger_events_open_idx ON public.ledger_events (status, id) WHERE status IN ('pending', 'failed', 'held');

-- Posted entries and their lines never change. The only update allowed is marking an entry reversed,
-- once, pointing at the reversing entry. Deleting is never allowed.
CREATE OR REPLACE FUNCTION public.ledger_entries_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Posted ledger entries cannot be deleted (entry %). Post a reversal instead.', OLD.number;
  END IF;
  IF OLD.status = 'posted' AND NEW.status = 'reversed' AND OLD.reversed_by_id IS NULL AND NEW.reversed_by_id IS NOT NULL
     AND (to_jsonb(NEW) - 'status' - 'reversed_by_id') = (to_jsonb(OLD) - 'status' - 'reversed_by_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Posted ledger entries are immutable (entry %). Post a reversal and a replacement.', OLD.number;
END $$;
DROP TRIGGER IF EXISTS ledger_entries_guard ON public.ledger_entries;
CREATE TRIGGER ledger_entries_guard BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_guard();

CREATE OR REPLACE FUNCTION public.ledger_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Ledger lines are immutable.';
END $$;
DROP TRIGGER IF EXISTS ledger_lines_guard ON public.ledger_lines;
CREATE TRIGGER ledger_lines_guard BEFORE UPDATE OR DELETE ON public.ledger_lines
  FOR EACH ROW EXECUTE FUNCTION public.ledger_lines_guard();

-- Every entry balances in the base currency, checked at commit after all its lines are in.
CREATE OR REPLACE FUNCTION public.ledger_entry_balance_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; n integer;
BEGIN
  SELECT COALESCE(SUM(base_debit), 0), COALESCE(SUM(base_credit), 0), COUNT(*) INTO d, c, n
  FROM public.ledger_lines WHERE entry_id = NEW.id;
  IF n < 2 THEN
    RAISE EXCEPTION 'Ledger entry % needs at least two lines', NEW.number;
  END IF;
  IF d <> c THEN
    RAISE EXCEPTION 'Ledger entry % is unbalanced: debits % <> credits %', NEW.number, d, c;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ledger_entry_balance_check ON public.ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entry_balance_check AFTER INSERT ON public.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_entry_balance_check();

-- Posting controls enforced by the database, not only by the posting service:
--  * nothing can be written while the posting switch is not 'on';
--  * every entry names an approved policy (both D-01 and VAT approvals) in force on its date;
--  * lines can only be added in the transaction that created their entry, so a posted entry can
--    never gain lines later (and the balance check above covers every line it will ever have).
CREATE OR REPLACE FUNCTION public.ledger_entries_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sw text;
BEGIN
  SELECT value_text INTO sw FROM public.financial_settings WHERE key = 'ledger_posting';
  IF COALESCE(sw, 'off') <> 'on' THEN
    RAISE EXCEPTION 'Ledger posting is switched off: no entry can be written (needs D-01 and VAT approval and sign-off)';
  END IF;
  IF NEW.policy_version IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.ledger_policies p
       WHERE p.version = NEW.policy_version AND p.status = 'approved' AND p.effective_from <= NEW.transaction_date) THEN
    RAISE EXCEPTION 'Ledger entry % needs an approved accounting policy in force on %', NEW.number, NEW.transaction_date;
  END IF;
  NEW.created_txid := txid_current();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ledger_entries_insert_guard ON public.ledger_entries;
CREATE TRIGGER ledger_entries_insert_guard BEFORE INSERT ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.ledger_entries_insert_guard();

CREATE OR REPLACE FUNCTION public.ledger_lines_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ledger_entries e WHERE e.id = NEW.entry_id AND e.created_txid = txid_current()) THEN
    RAISE EXCEPTION 'Lines can only be added while their entry is being posted; post a new entry instead';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ledger_lines_insert_guard ON public.ledger_lines;
CREATE TRIGGER ledger_lines_insert_guard BEFORE INSERT ON public.ledger_lines
  FOR EACH ROW EXECUTE FUNCTION public.ledger_lines_insert_guard();

-- Posting switch: 'off' until D-01 is approved and the parallel run is signed off.
INSERT INTO public.financial_settings (key, value_text)
VALUES ('ledger_posting', 'off')
ON CONFLICT (key) DO NOTHING;
