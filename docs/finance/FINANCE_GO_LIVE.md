# Finance Go-Live Runbook (Phases 3–7 with the accountant's decisions)

**For:** the owner, the DBA and two admins plus one finance user (named below). **Rehearsed end to end** on a real PostgreSQL 17.5 with synthetic data (`rehearsal/local/golive-real-test.js`, 20/20), using only the commands in this runbook.

**Decisions applied** (`ACCOUNTANT_DECISION_TRACKER.md`):
- gross revenue;
- VAT 0 from 25/11 while taxes are negotiated;
- no historical commissions;
- books start 25/11, so there is **no historical import** (Phase 4 has nothing to import);
- refunds reverse revenue and tax;
- the owner's share of forfeits.

## People
| Role | Who | Does |
|---|---|---|
| Admin A | ________ | Revenue approval; switches posting and reports |
| Admin B (not A) | ________ | VAT-base approval |
| Recorder (finance, not A or B) | ________ | Records the policy |
| DBA | ________ | Backup, deploy, settings, roles and key |

## Before the window
1. **Rotate the production database password** (it was shared in chat). Keep the new one only in Railway's secret settings.
2. The release `release/2026-11-25` (fixes and security) is deployed first, by its own checklist (`Desktop/Main-Soul-preserved/CONTROLLED_DEPLOYMENT_CHECKLIST_2026-11-25.md`).
3. **Backup** taken and its id recorded. **Restore test:** restore into a separate Supabase project and run `rehearsal/r0_table_inventory.sql` there. It must equal the 2026-11-25 baseline: 140 tables, 78,181 rows (`production-baseline-2026-11-25`, kept privately), allowing for activity since.
4. **Merge** `feature/finance-ledger` into `main` with `docs/finance/merge/resolve-package-json.js`, then run `npm test`.

## Go-live (in this order)
1. **Deploy:** set `MIGRATION_DATABASE_URL` (owner) and `FINANCE_BOOKS_START=2026-11-25` on Railway, then deploy.
   - The app applies 175, 176, 177 and 178.
   - **Check** with live check 0 (now 178) and `rehearsal/r2_verify_structure.sql` (18/18).
2. **Accountant's settings:** the DBA runs `docs/finance/deployment/2026-11-25_accountant_settings.sql`. It applies books from 25/11 (Cairo midnight), the VAT suspension and the commission decision, and prints the values before and after.
3. **Security:** `db-security/ledger_roles.sql` and `provision_identity_key.sql`; put the key in Railway; switch `DATABASE_URL` to `soul_app`; restart.
4. **Policy** (each person runs their own step; the database refuses any other order):
   ```
   node scripts/ledger-policy.js approve --purpose d01 --version 2026.11 --actor <A> --confirm-host <host> --execute
   node scripts/ledger-policy.js approve --purpose vat --version 2026.11 --actor <B> --confirm-host <host> --execute
   node scripts/ledger-policy.js record --version 2026.11 --effective 2026-11-25 --settings docs/finance/deployment/policy-2026.11.json \
        --actor <Recorder> --d01-approver <A> --d01-ref "<accountant's signed copy ref>" --vat-approver <B> --vat-ref "<same or separate ref>" --confirm-host <host> --execute
   ```
5. **Posting on:** `node scripts/ledger-policy.js posting on --actor <A> --reason "<owner authorisation ref>" --confirm-host <host> --execute`
6. **Post the books from 25/11 and reconcile:**
   ```
   node scripts/ledger-migration.js sync --from 2026-11-25 --to <today> --policy 2026.11 --actor <A> --confirm-host <host> --execute
   ```
   The result must be `clean: true`. A range starting before 25/11 is refused, because it straddles the VAT change.
7. **Parallel month (Phase 5):** run the same `sync` nightly (or after busy days) until the end of December; the nightly reconciliation runs by itself. At the December month end the accountant compares both sources (Ledger controls → Reconciliation, and the statements).
8. **Activate reporting (Phase 6), after the clean month and the owner's written instruction:** `node scripts/ledger-policy.js reports ledger --actor <A> --reason "<ref>" --confirm-host <host> --execute`. The statements then say "Built from the stored ledger".
9. **Operate (Phase 7):** `FINANCIAL_OPERATIONS.md`, covering the daily Data health check, Reconcile now, the month-end step and the monthly review.

## Rollback
- Reports back to the calculation: `reports engine` (any time).
- Posting off: `posting off` (after reports are back on the engine).
- Full removal before real use: `rollback_178` → `rollback_177` → `rollback_176` (→ `rollback_175_*`). Each refuses the wrong order.

## What still needs a person
- The signed copy reference for step 4.
- The answer on **withholding tax**.
- Supabase and Railway access for steps 1–3.
- The owner's written instructions for steps 5 and 8.
