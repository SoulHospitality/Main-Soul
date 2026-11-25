-- 178: recurring reconciliation results (Phase 7). Each run of the stored-ledger reconciliation (nightly job or
-- "Reconcile now") is recorded here, append-only, so differences are monitored and the history is an audit trail.
-- Additive; changes no existing row. Runs are only recorded while ledger posting is on.

CREATE TABLE IF NOT EXISTS public.ledger_reconciliation_runs (
  id                  bigserial PRIMARY KEY,
  ran_at              timestamptz NOT NULL DEFAULT now(),
  trigger             text NOT NULL CHECK (trigger IN ('nightly', 'manual')),
  run_by              integer,
  period_from         date NOT NULL,
  period_to           date NOT NULL,
  clean               boolean NOT NULL,
  buckets             jsonb NOT NULL,
  account_differences jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample              jsonb NOT NULL DEFAULT '[]'::jsonb,
  CHECK (period_from <= period_to)
);
CREATE INDEX IF NOT EXISTS ledger_reconciliation_runs_ran_at ON public.ledger_reconciliation_runs (ran_at DESC);

CREATE OR REPLACE FUNCTION public.ledger_reconciliation_runs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reconciliation runs are permanent: they cannot be changed or deleted';
END $$;
DROP TRIGGER IF EXISTS ledger_reconciliation_runs_append_only ON public.ledger_reconciliation_runs;
CREATE TRIGGER ledger_reconciliation_runs_append_only BEFORE UPDATE OR DELETE ON public.ledger_reconciliation_runs
  FOR EACH ROW EXECUTE FUNCTION public.ledger_reconciliation_runs_append_only();
DROP TRIGGER IF EXISTS ledger_reconciliation_runs_no_truncate ON public.ledger_reconciliation_runs;
CREATE TRIGGER ledger_reconciliation_runs_no_truncate BEFORE TRUNCATE ON public.ledger_reconciliation_runs
  FOR EACH STATEMENT EXECUTE FUNCTION public.ledger_no_truncate();

-- Supabase API lockdown (same rule as migrations 095/176).
ALTER TABLE public.ledger_reconciliation_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ledger_reconciliation_runs FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE 'REVOKE ALL ON TABLE public.ledger_reconciliation_runs FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE 'REVOKE ALL ON TABLE public.ledger_reconciliation_runs FROM authenticated'; END IF;
END $$;
