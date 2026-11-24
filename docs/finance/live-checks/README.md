# Live database checks (read-only)

Check 0 confirms which version production is on. Checks 1–6 come from FINANCIAL_SYSTEM_AUDIT.md §6. All seven must be run by an authorised database administrator against the production database before deployment. **No result has been received yet; nothing in the plan assumes these checks pass.**

## Safety
- Every script runs inside `BEGIN TRANSACTION READ ONLY; … ROLLBACK;`. Postgres refuses any write inside a read-only transaction, so even a mistaken edit cannot change data.
- No `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, or function calls with side effects.
- Output is counts, sums, dates and internal record numbers only — no guest names, phones, emails, ID numbers, or staff names.

## Minimum permissions
Run as a dedicated read-only role, not the application's owner role. A database administrator creates it once (this is the only statement that is not read-only, and it is optional if a read-only role already exists):

```sql
CREATE ROLE finance_checks LOGIN PASSWORD '<set privately>' NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT USAGE ON SCHEMA public TO finance_checks;
GRANT SELECT (id, amount, payment_date, payment_method, transaction_reference, status, kind, created_at, reservation_id)
  ON public.payments TO finance_checks;
GRANT SELECT (id, amount, expense_date, created_at) ON public.expenses TO finance_checks;
GRANT SELECT (id, unit_id, sales_person_id, status, check_in, created_at, total_amount, currency, exchange_rate)
  ON public.reservations TO finance_checks;
GRANT SELECT (entry_type, amount, entry_date) ON public.cash_ledger TO finance_checks;
GRANT SELECT (id, action, entity_type, entity_id, details, created_at) ON public.audit_log TO finance_checks;
GRANT SELECT (year_month, kind, entry_id, entry) ON public.financial_posted_entries TO finance_checks;
GRANT SELECT (id) ON public._schema_migrations TO finance_checks;
GRANT SELECT (key) ON public.financial_settings TO finance_checks;
ALTER ROLE finance_checks SET default_transaction_read_only = on;
```

Revoke or drop the role after the checks: `DROP ROLE finance_checks;`, after `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM finance_checks; REVOKE USAGE ON SCHEMA public FROM finance_checks;`.

## How to run
Use `psql` as the read-only role, from the repository root:

```bash
cd docs/finance/live-checks
for f in 00 01 02 03 04 05 06; do
  psql "$READONLY_DATABASE_URL" -v ON_ERROR_STOP=1 -P pager=off -f ${f}_*.sql > result_${f}.txt 2>&1
done
```

In the Supabase SQL editor, paste each file whole and run it. Its `BEGIN TRANSACTION READ ONLY` still protects the data.

Send the seven `result_*.txt` files back privately, not through a public channel, and do not commit them. Fill in the results table in `DEPLOYMENT_READINESS.md` §2. Record who ran the checks and when.

## The checks

| File | Verifies | Reading the result |
|---|---|---|
| `00_deployment_state.sql` | Production is still on the existing implementation | Expected: last migration `174_…`, "175 or 176 applied" = 0, no snapshot column, 0 ledger tables, no `ledger_posting` setting. Anything else means a migration ran early, so **stop and report it**. |
| `01_amount_quality.sql` | Rows per finance table since the books start (2026-10-01); null, zero, negative and unusually large amounts | Negatives are expected only for refunds (`payments.kind = 'refund'`). Nulls or zero totals on confirmed stays, and amounts above the stated threshold, are listed for review before migration. |
| `02_usd_rates.sql` | USD reservations missing an exchange rate, and the spread of rates used | Any row in the "missing rate" list blocks migrating that reservation: its EGP value cannot be established without inventing a rate. |
| `03_duplicate_payment_refs.sql` | Payments sharing the same method + transaction reference | 0 groups = the unique index exists and duplicates are impossible. Any group = possible double-recorded payment to investigate. |
| `04_cash_ledger_vs_cash.sql` | The legacy `cash_ledger` monthly in/out totals next to cash collections and cash refunds from `payments` | Shows how far the legacy record drifts from the cash the books see. Expected to differ (it was never complete); confirms it can be retired as read-only history. |
| `05_commission_rate_changes.sql` | Units whose commission % was changed, and how many confirmed stays predate the change | Those stays cannot get a reliable rate snapshot automatically; they are the manual-review list for D-12. |
| `06_frozen_months_balance.sql` | Each closed (frozen) month: total debits vs credits of the saved journal | Difference must be 0.00 for every month. Any other value means a closed month's saved books do not balance and must be explained before it is imported. |
