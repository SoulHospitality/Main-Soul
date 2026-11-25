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
  created_by     integer,   -- the person who recorded the policy; neither approver may be the same person
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'approved' OR (
    approved_by IS NOT NULL AND approved_at IS NOT NULL AND approval_ref IS NOT NULL
    AND vat_approved_by IS NOT NULL AND vat_approved_at IS NOT NULL AND vat_approval_ref IS NOT NULL
    AND settings ? 'revenue_presentation' AND settings ? 'vat_base'))
);
-- One approved policy per effective date, so "the policy in force on a date" is never ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_policies_one_approved_per_date
  ON public.ledger_policies (effective_from) WHERE status = 'approved';

-- An active admin (until D-14 sets finance roles). NOTE: every staff id given to the database (approver,
-- app.actor_id, closed_by …) is a CLAIM made by the connecting application. The database checks that the
-- named person is an active admin; it cannot prove the session is that person (see POSTING_CONTROLS_AUDIT).
CREATE OR REPLACE FUNCTION public.ledger_is_active_admin(staff_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.staff_users WHERE id = staff_id AND role = 'admin'
                 AND COALESCE(is_active::text, '1') NOT IN ('0', 'false', 'f'))
$$;

-- ── Verified identity (review finding H3) ─────────────────────────────────────────────────────────────
-- Who is acting is never taken from a caller-supplied id. The application signs a short-lived claim
--   v1.<key_id>.<actor_id>.<txid>.<expiry_epoch>.act.<hex HMAC-SHA256 of "v1|key_id|actor|txid|expiry|act">
-- with a key it holds outside the database, bound to the CURRENT transaction (txid) and set as
-- app.identity_claim. ledger_verified_actor() checks it against the key stored in ledger_identity_keys.
-- Protection depends on the deployment (docs/finance/db-security/README.md): the application must connect
-- as a restricted role that cannot read ledger_identity_keys or change these functions. Until then, anyone
-- with owner-level database access can read the key, so identity is only as strong as that access.
CREATE TABLE IF NOT EXISTS public.ledger_identity_keys (
  key_id     text PRIMARY KEY CHECK (key_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  secret     bytea NOT NULL CHECK (length(secret) >= 32),
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.ledger_identity_keys FROM PUBLIC;
CREATE OR REPLACE FUNCTION public.ledger_identity_keys_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.secret IS NOT DISTINCT FROM OLD.secret AND NEW.key_id = OLD.key_id THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Identity keys cannot be changed or deleted; add a new key and deactivate the old one';
END $$;
DROP TRIGGER IF EXISTS ledger_identity_keys_guard ON public.ledger_identity_keys;
CREATE TRIGGER ledger_identity_keys_guard BEFORE UPDATE OR DELETE ON public.ledger_identity_keys
  FOR EACH ROW EXECUTE FUNCTION public.ledger_identity_keys_guard();

-- HMAC-SHA256 (RFC 2104) on the built-in sha256(), so no extension is needed.
CREATE OR REPLACE FUNCTION public.ledger_hmac_sha256(k bytea, msg bytea) RETURNS bytea LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE kk bytea := k; ipad bytea; opad bytea; i int;
BEGIN
  IF length(kk) > 64 THEN kk := sha256(kk); END IF;
  kk := kk || decode(repeat('00', 64 - length(kk)), 'hex');
  ipad := kk; opad := kk;
  FOR i IN 0..63 LOOP
    ipad := set_byte(ipad, i, get_byte(kk, i) # 54);   -- 0x36
    opad := set_byte(opad, i, get_byte(kk, i) # 92);   -- 0x5c
  END LOOP;
  RETURN sha256(opad || sha256(ipad || msg));
END $$;

-- The staff id proven by the signed claim of this transaction, or NULL.
CREATE OR REPLACE FUNCTION public.ledger_verified_actor() RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE claim text := current_setting('app.identity_claim', true); p text[]; k bytea;
BEGIN
  IF claim IS NULL OR claim = '' THEN RETURN NULL; END IF;
  p := string_to_array(claim, '.');
  IF array_length(p, 1) <> 7 OR p[1] <> 'v1' OR p[6] <> 'act' OR p[3] !~ '^[0-9]{1,9}$' THEN RETURN NULL; END IF;
  IF p[4] <> txid_current()::text THEN RETURN NULL; END IF;                       -- bound to this transaction
  IF p[5] !~ '^[0-9]{1,12}$' OR p[5]::bigint < extract(epoch FROM clock_timestamp())::bigint THEN RETURN NULL; END IF;
  SELECT secret INTO k FROM public.ledger_identity_keys WHERE key_id = p[2] AND active;
  IF k IS NULL THEN RETURN NULL; END IF;
  IF encode(public.ledger_hmac_sha256(k, convert_to(array_to_string(p[1:6], '|'), 'UTF8')), 'hex') <> lower(p[7]) THEN
    RETURN NULL;
  END IF;
  RETURN p[3]::integer;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- Refuse unless `claimed` is the verified actor of this transaction.
CREATE OR REPLACE FUNCTION public.ledger_require_actor(claimed integer, what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v integer := public.ledger_verified_actor();
BEGIN
  IF v IS NULL THEN
    RAISE EXCEPTION '%: no verified identity in this transaction (signed app.identity_claim required)', what;
  END IF;
  IF claimed IS DISTINCT FROM v THEN
    RAISE EXCEPTION '%: the named person (%) is not the verified actor of this transaction', what, COALESCE(claimed::text, 'none');
  END IF;
END $$;

-- Approvals are recorded by the approver, in their own verified transaction, before the action they
-- approve. Append-only.
CREATE TABLE IF NOT EXISTS public.ledger_approvals (
  id            bigserial PRIMARY KEY,
  purpose       text NOT NULL CHECK (purpose IN ('policy_d01', 'policy_vat', 'closed_period_adjustment', 'commission_correction')),
  subject       text NOT NULL,
  approver_id   integer NOT NULL,
  approved_at   timestamptz NOT NULL DEFAULT now(),
  approved_txid bigint NOT NULL DEFAULT txid_current(),
  UNIQUE (purpose, subject, approver_id)
);
CREATE OR REPLACE FUNCTION public.ledger_approvals_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Approvals are a permanent record and cannot be changed or deleted'; END IF;
  PERFORM public.ledger_require_actor(NEW.approver_id, 'Recording an approval');
  IF NOT public.ledger_is_active_admin(NEW.approver_id) THEN
    RAISE EXCEPTION 'Only an active admin can record an approval';
  END IF;
  NEW.approved_at := now();
  NEW.approved_txid := txid_current();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ledger_approvals_guard ON public.ledger_approvals;
CREATE TRIGGER ledger_approvals_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_approvals
  FOR EACH ROW EXECUTE FUNCTION public.ledger_approvals_guard();

-- An approval by `approver` for (purpose, subject), recorded in an EARLIER transaction than this one.
CREATE OR REPLACE FUNCTION public.ledger_has_approval(p_purpose text, p_subject text, approver integer) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM public.ledger_approvals
                 WHERE purpose = p_purpose AND subject = p_subject AND approver_id = approver
                   AND approved_txid <> txid_current())
$$;

-- Policies: approval needs two active-admin approvers (D-01 and VAT), each different from the person who
-- recorded the policy. An approved policy is a permanent record: it can only be retired, never edited or
-- deleted.
CREATE OR REPLACE FUNCTION public.ledger_policies_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'draft' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Accounting policy % has been approved and cannot be deleted', OLD.version;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' THEN
    IF OLD.status = 'approved' AND NEW.status = 'retired'
       AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      IF NOT public.ledger_is_active_admin(public.ledger_verified_actor()) THEN
        RAISE EXCEPTION 'Retiring policy % needs a verified active admin', OLD.version;
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Accounting policy % is % and cannot be changed; create a new version', OLD.version, OLD.status;
  END IF;
  -- INSERT, or a draft being edited / approved.
  IF NEW.status = 'retired' AND (TG_OP = 'INSERT' OR OLD.status <> 'approved') THEN
    RAISE EXCEPTION 'Only an approved policy can be retired';
  END IF;
  IF NEW.status = 'approved' THEN
    IF NEW.created_by IS NULL OR NOT EXISTS (SELECT 1 FROM public.staff_users WHERE id = NEW.created_by) THEN
      RAISE EXCEPTION 'Policy %: created_by must name the staff member who recorded it', NEW.version;
    END IF;
    IF NOT public.ledger_is_active_admin(NEW.approved_by) OR NOT public.ledger_is_active_admin(NEW.vat_approved_by) THEN
      RAISE EXCEPTION 'Policy %: both approvers (D-01 and VAT) must be active admins', NEW.version;
    END IF;
    IF NEW.approved_by = NEW.created_by OR NEW.vat_approved_by = NEW.created_by THEN
      RAISE EXCEPTION 'Policy %: an approver cannot be the person who recorded the policy', NEW.version;
    END IF;
    -- Verified identity: the recorder is the verified actor of this transaction, and each approver recorded
    -- their own approval earlier, in their own verified transaction.
    PERFORM public.ledger_require_actor(NEW.created_by, format('Recording policy %s', NEW.version));
    IF NOT public.ledger_has_approval('policy_d01', NEW.version, NEW.approved_by) THEN
      RAISE EXCEPTION 'Policy %: approver % has not recorded the D-01 approval', NEW.version, NEW.approved_by;
    END IF;
    IF NOT public.ledger_has_approval('policy_vat', NEW.version, NEW.vat_approved_by) THEN
      RAISE EXCEPTION 'Policy %: approver % has not recorded the VAT-base approval', NEW.version, NEW.vat_approved_by;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ledger_policies_guard ON public.ledger_policies;
CREATE TRIGGER ledger_policies_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_policies
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
  replaces_id      bigint REFERENCES public.ledger_entries(id),  -- replacement entry: points at the entry it corrects
  payload_hash     text,                                         -- fingerprint of the posted content (idempotency check)
  created_by       integer,
  approved_by      integer,
  created_txid     bigint NOT NULL DEFAULT txid_current(),  -- set by the insert guard; lines must join in the same transaction
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (period = to_char(transaction_date, 'YYYY-MM')),
  CHECK (origin NOT IN ('manual', 'adjustment', 'reversal') OR created_by IS NOT NULL),
  CHECK ((origin = 'reversal') = (reverses_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ledger_entries_source_idx ON public.ledger_entries (source_type, source_id);
-- An entry can be reversed once and replaced once, whatever path writes the rows.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_reversal ON public.ledger_entries (reverses_id) WHERE reverses_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_one_replacement ON public.ledger_entries (replaces_id) WHERE replaces_id IS NOT NULL;
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
     AND (to_jsonb(NEW) - 'status' - 'reversed_by_id') = (to_jsonb(OLD) - 'status' - 'reversed_by_id')
     AND EXISTS (SELECT 1 FROM public.ledger_entries r
                 WHERE r.id = NEW.reversed_by_id AND r.origin = 'reversal' AND r.reverses_id = OLD.id) THEN
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
--  * the policy is the one IN FORCE on the entry date (the latest approved policy effective on or before
--    it); a reversal instead keeps the policy of the entry it reverses, even if that policy has since
--    been retired, so corrections stay possible after a policy change.

-- The policy in force on a date: the latest approved policy effective on or before it.
CREATE OR REPLACE FUNCTION public.ledger_policy_in_force(on_date date) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT version FROM public.ledger_policies
  WHERE status = 'approved' AND effective_from <= on_date
  ORDER BY effective_from DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.ledger_entries_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sw text; pstatus text; orig record; orig_policy_status text;
BEGIN
  SELECT value_text INTO sw FROM public.financial_settings WHERE key = 'ledger_posting';
  IF COALESCE(sw, 'off') <> 'on' THEN
    RAISE EXCEPTION 'Ledger posting is switched off: no entry can be written (needs D-01 and VAT approval and sign-off)';
  END IF;
  IF NEW.origin = 'reversal' THEN
    SELECT * INTO orig FROM public.ledger_entries WHERE id = NEW.reverses_id;
    SELECT status INTO orig_policy_status FROM public.ledger_policies WHERE version = orig.policy_version;
    IF NEW.policy_version IS DISTINCT FROM orig.policy_version OR orig_policy_status NOT IN ('approved', 'retired') THEN
      RAISE EXCEPTION 'Reversal % must keep the policy of the entry it reverses (%)', NEW.number, orig.policy_version;
    END IF;
  ELSIF NEW.policy_version IS NULL OR NEW.policy_version IS DISTINCT FROM public.ledger_policy_in_force(NEW.transaction_date) THEN
    RAISE EXCEPTION 'Ledger entry % needs the approved accounting policy in force on % (%), not %',
      NEW.number, NEW.transaction_date, COALESCE(public.ledger_policy_in_force(NEW.transaction_date), 'none'), COALESCE(NEW.policy_version, 'none');
  END IF;
  -- Verified identity: whoever is named as creator must be the verified actor of this transaction
  -- (always for manual, adjustment and reversal entries, which require a creator).
  IF NEW.created_by IS NOT NULL THEN
    PERFORM public.ledger_require_actor(NEW.created_by, format('Posting entry %s', NEW.number));
  END IF;
  -- Closed periods: only an adjustment approved by a different active admin, who recorded that approval
  -- (purpose closed_period_adjustment, subject = the entry's idempotency key) in their own transaction.
  SELECT status INTO pstatus FROM public.ledger_periods WHERE period = NEW.period;
  IF pstatus = 'closed' AND NOT (NEW.origin = 'adjustment' AND NEW.approved_by IS NOT NULL
       AND NEW.approved_by IS DISTINCT FROM NEW.created_by AND public.ledger_is_active_admin(NEW.approved_by)
       AND public.ledger_has_approval('closed_period_adjustment', NEW.idempotency_key, NEW.approved_by)) THEN
    RAISE EXCEPTION 'Period % is closed: only an adjustment approved (and recorded) by a different active admin can be posted', NEW.period;
  END IF;
  -- Reversals: of an existing posted, non-reversal entry, dated on or after it.
  IF NEW.origin = 'reversal' THEN
    SELECT * INTO orig FROM public.ledger_entries WHERE id = NEW.reverses_id;
    IF orig.id IS NULL OR orig.status <> 'posted' OR orig.origin = 'reversal' THEN
      RAISE EXCEPTION 'Entry % can only reverse a posted entry that is not itself a reversal', NEW.number;
    END IF;
    IF NEW.transaction_date < orig.transaction_date THEN
      RAISE EXCEPTION 'A reversal cannot be dated before the entry it reverses (%)', orig.transaction_date;
    END IF;
  END IF;
  IF NEW.replaces_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.ledger_entries WHERE id = NEW.replaces_id AND status = 'reversed') THEN
    RAISE EXCEPTION 'A replacement must point at an entry that has been reversed';
  END IF;
  NEW.created_txid := txid_current();
  NEW.status := 'posted';
  NEW.reversed_by_id := NULL;
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

-- Periods: closing and reopening are attributed; reopening needs an admin and a reason; closed periods
-- cannot be deleted.
CREATE OR REPLACE FUNCTION public.ledger_periods_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'open' THEN RAISE EXCEPTION 'Period % is % and cannot be deleted', OLD.period, OLD.status; END IF;
    RETURN OLD;
  END IF;
  IF NEW.status = 'closed' AND (TG_OP = 'INSERT' OR OLD.status <> 'closed') THEN
    IF NEW.closed_by IS NULL OR NOT public.ledger_is_active_admin(NEW.closed_by) THEN
      RAISE EXCEPTION 'Closing period % needs closed_by: an active admin', NEW.period;
    END IF;
    PERFORM public.ledger_require_actor(NEW.closed_by, format('Closing period %s', NEW.period));
    NEW.closed_at := now();
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    IF NEW.reopened_by IS NULL OR NOT public.ledger_is_active_admin(NEW.reopened_by)
       OR length(btrim(COALESCE(NEW.reopen_reason, ''))) < 10 THEN
      RAISE EXCEPTION 'Reopening period % needs reopened_by (an active admin) and a reason of at least 10 characters', NEW.period;
    END IF;
    PERFORM public.ledger_require_actor(NEW.reopened_by, format('Reopening period %s', NEW.period));
    NEW.reopened_at := now();
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'closed' AND NEW.status = 'closed'
     AND (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'A closed period record cannot be edited; reopen it first';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ledger_periods_guard ON public.ledger_periods;
CREATE TRIGGER ledger_periods_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_periods
  FOR EACH ROW EXECUTE FUNCTION public.ledger_periods_guard();

-- Reversal lines must mirror the original exactly (checked at commit, with the balance check).
CREATE OR REPLACE FUNCTION public.ledger_reversal_mirror_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.origin <> 'reversal' THEN RETURN NULL; END IF;
  IF EXISTS (
       (SELECT account_code, base_debit, base_credit, currency, debit, credit FROM public.ledger_lines WHERE entry_id = NEW.id
        EXCEPT ALL
        SELECT account_code, base_credit, base_debit, currency, credit, debit FROM public.ledger_lines WHERE entry_id = NEW.reverses_id)
       UNION ALL
       (SELECT account_code, base_credit, base_debit, currency, credit, debit FROM public.ledger_lines WHERE entry_id = NEW.reverses_id
        EXCEPT ALL
        SELECT account_code, base_debit, base_credit, currency, debit, credit FROM public.ledger_lines WHERE entry_id = NEW.id)) THEN
    RAISE EXCEPTION 'Reversal % does not mirror the lines of the entry it reverses', NEW.number;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS ledger_reversal_mirror_check ON public.ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_reversal_mirror_check AFTER INSERT ON public.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.ledger_reversal_mirror_check();

-- Posting switch: 'off' until D-01 is approved and the parallel run is signed off. Every change is logged
-- (append-only); turning it on needs an approved policy and a named active admin.
CREATE TABLE IF NOT EXISTS public.ledger_control_log (
  id         bigserial PRIMARY KEY,
  control    text NOT NULL,
  old_value  text,
  new_value  text,
  actor_id   integer,
  reason     text,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.ledger_control_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Rows are written only by the switch guard (a trigger, so depth ≥ 2); a direct INSERT is refused.
  IF TG_OP = 'INSERT' AND pg_trigger_depth() >= 2 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'The ledger control log is a permanent record written only by the posting-switch guard';
END $$;
DROP TRIGGER IF EXISTS ledger_control_log_append_only ON public.ledger_control_log;
CREATE TRIGGER ledger_control_log_append_only BEFORE INSERT OR UPDATE OR DELETE ON public.ledger_control_log
  FOR EACH ROW EXECUTE FUNCTION public.ledger_control_log_append_only();

-- SECURITY DEFINER: the restricted application role needs no privilege on the control log.
CREATE OR REPLACE FUNCTION public.ledger_posting_switch_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor integer; reason text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.key = 'ledger_posting' THEN RAISE EXCEPTION 'The ledger posting switch cannot be deleted'; END IF;
    RETURN OLD;
  END IF;
  -- The switch row keeps its key: renaming it away, or renaming another row into it, is refused (this
  -- closes the rename-and-decoy route that skipped the checks and the log).
  IF TG_OP = 'UPDATE' AND OLD.key IS DISTINCT FROM NEW.key AND 'ledger_posting' IN (OLD.key, NEW.key) THEN
    RAISE EXCEPTION 'The ledger posting switch row cannot be renamed, and no row can be renamed into it';
  END IF;
  IF NEW.key <> 'ledger_posting' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.value_text IS NOT DISTINCT FROM OLD.value_text THEN RETURN NEW; END IF;
  IF NEW.value_text NOT IN ('on', 'off') THEN
    RAISE EXCEPTION 'The ledger posting switch must be on or off';
  END IF;
  -- The actor is the VERIFIED identity of this transaction (signed app.identity_claim), never a claimed id.
  actor := public.ledger_verified_actor();
  reason := btrim(COALESCE(current_setting('app.control_reason', true), ''));
  IF NEW.value_text = 'on' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ledger_policies WHERE status = 'approved') THEN
      RAISE EXCEPTION 'Ledger posting cannot be switched on before an accounting policy (D-01 and VAT base) is approved';
    END IF;
    IF actor IS NULL OR NOT public.ledger_is_active_admin(actor) OR length(reason) < 10 THEN
      RAISE EXCEPTION 'Switching ledger posting on needs a verified active admin (signed app.identity_claim) and app.control_reason (10+ characters)';
    END IF;
  END IF;
  INSERT INTO public.ledger_control_log (control, old_value, new_value, actor_id, reason)
  VALUES ('ledger_posting', CASE WHEN TG_OP = 'UPDATE' THEN OLD.value_text END, NEW.value_text, actor, NULLIF(reason, ''));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS financial_settings_ledger_posting_guard ON public.financial_settings;
CREATE TRIGGER financial_settings_ledger_posting_guard BEFORE INSERT OR UPDATE OR DELETE ON public.financial_settings
  FOR EACH ROW EXECUTE FUNCTION public.ledger_posting_switch_guard();

-- TRUNCATE skips row-level triggers, so every permanent table gets a statement-level guard too
-- (including financial_settings, which holds the posting switch). TRUNCATE … CASCADE fires it on each
-- table it reaches. Removing the ledger is only possible by dropping it (rollback_176.sql).
CREATE OR REPLACE FUNCTION public.ledger_no_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is a permanent finance record and cannot be truncated', TG_TABLE_NAME;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_accounts', 'ledger_policies', 'ledger_periods', 'ledger_entries', 'ledger_lines',
                           'ledger_events', 'ledger_control_log', 'financial_settings',
                           'ledger_identity_keys', 'ledger_approvals'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_no_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_no_truncate()',
                   t || '_no_truncate', t);
  END LOOP;
END $$;

-- Chart of accounts: once an account has posted lines, its code, type, normal balance and currency are
-- fixed (changing them would reclassify history). Name, description and active flag may change.
CREATE OR REPLACE FUNCTION public.ledger_accounts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.ledger_lines WHERE account_code = OLD.code) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Account % has posted lines and cannot be deleted; deactivate it instead', OLD.code;
    END IF;
    IF NEW.code IS DISTINCT FROM OLD.code OR NEW.account_type IS DISTINCT FROM OLD.account_type
       OR NEW.normal_balance IS DISTINCT FROM OLD.normal_balance OR NEW.currency IS DISTINCT FROM OLD.currency THEN
      RAISE EXCEPTION 'Account % has posted lines: its code, type, normal balance and currency cannot change', OLD.code;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS ledger_accounts_guard ON public.ledger_accounts;
CREATE TRIGGER ledger_accounts_guard BEFORE UPDATE OR DELETE ON public.ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION public.ledger_accounts_guard();

-- Custom accounts created or edited in the Financial System after this migration are kept in the ledger
-- chart (a removed custom account is only deactivated). The accounts guard above still applies.
-- SECURITY DEFINER: the restricted application role keeps read-only access to the ledger chart.
CREATE OR REPLACE FUNCTION public.ledger_sync_custom_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.ledger_accounts SET active = false, updated_at = now() WHERE code = OLD.code;
    RETURN OLD;
  END IF;
  INSERT INTO public.ledger_accounts (code, name, account_type, normal_balance, parent_code)
  VALUES (NEW.code, NEW.name,
          CASE NEW.account_group WHEN 'assets' THEN 'asset' WHEN 'liabilities' THEN 'liability' WHEN 'equity' THEN 'equity'
                                 WHEN 'revenue' THEN 'revenue' ELSE 'expense' END,
          CASE WHEN NEW.account_group IN ('assets', 'expenses') THEN 'debit' ELSE 'credit' END,
          CASE WHEN EXISTS (SELECT 1 FROM public.ledger_accounts p WHERE p.code = NEW.parent_code) THEN NEW.parent_code END)
  ON CONFLICT (code) DO UPDATE
    SET name = EXCLUDED.name, account_type = EXCLUDED.account_type, normal_balance = EXCLUDED.normal_balance,
        parent_code = EXCLUDED.parent_code, active = true, updated_at = now()
    WHERE NOT public.ledger_accounts.is_system;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS financial_custom_accounts_ledger_sync ON public.financial_custom_accounts;
CREATE TRIGGER financial_custom_accounts_ledger_sync AFTER INSERT OR UPDATE OR DELETE ON public.financial_custom_accounts
  FOR EACH ROW EXECUTE FUNCTION public.ledger_sync_custom_account();

INSERT INTO public.financial_settings (key, value_text)
VALUES ('ledger_posting', 'off')
ON CONFLICT (key) DO NOTHING;

-- Supabase API lockdown (same rule as migration 095): row-level security on, no access for PUBLIC, anon or
-- authenticated. The restricted application role gets explicit policies from docs/finance/db-security/
-- ledger_roles.sql; ledger_identity_keys gets none, so only its owner (and SECURITY DEFINER checks) read it.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ledger_accounts', 'ledger_policies', 'ledger_periods', 'ledger_entries', 'ledger_lines',
                           'ledger_events', 'ledger_control_log', 'ledger_identity_keys', 'ledger_approvals'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t); END IF;
  END LOOP;
END $$;
