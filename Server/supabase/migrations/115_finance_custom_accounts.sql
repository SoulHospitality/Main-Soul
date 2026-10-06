-- User-defined sub-accounts added from Financial System on top of the built-in chart

CREATE TABLE IF NOT EXISTS public.financial_custom_accounts (
  code varchar(12) PRIMARY KEY,
  name text NOT NULL,
  account_group varchar(20) NOT NULL
    CHECK (account_group = ANY (ARRAY['assets'::text, 'liabilities'::text, 'equity'::text, 'revenue'::text, 'expenses'::text])),
  parent_code varchar(12),
  created_by integer REFERENCES public.staff_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_custom_accounts_group_idx
  ON public.financial_custom_accounts (account_group);
