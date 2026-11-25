# Finance Go-Live Runbook (Phases 3–7 with the accountant's decisions)

**For:** the owner, the CEOs and financial managers, and whoever deploys.

**Rehearsed** on a real PostgreSQL 17.5 with synthetic data:
- `golive-inapp-test.js`, 20/20: from inside the app;
- `golive-real-test.js`, 20/20: the command-line route.

**Decisions** (`ACCOUNTANT_DECISION_TRACKER.md`):
- gross revenue;
- VAT **and withholding** suspended from 25/11;
- no historical commissions;
- books start 25/11, so there is no historical import and the opening balances are to come from the owner;
- refunds reverse revenue and tax;
- the owner's share of forfeits;
- CEOs and financial managers approve and run the ledger.

## 1. Deploy (needs Railway, Vercel and the database password)
1. Deploy `release/2026-11-25` (fixes and security) by its checklist.
2. Merge `feature/finance-ledger` into `main` with `docs/finance/merge/resolve-package-json.js`, then run `npm test`.
3. On Railway set:
   - `MIGRATION_DATABASE_URL` (owner connection);
   - `FINANCE_BOOKS_START=2026-11-25`;
   - the identity key `LEDGER_IDENTITY_KEY_ID` and `LEDGER_IDENTITY_KEY` (`db-security/provision_identity_key.sql` inserts the same key in the database).

   Then deploy. The app applies 175–179. **Check:** live check 0 (now 179) and `rehearsal/r2_verify_structure.sql` (19/19).
   **Never re-run `176_ledger_core.sql` by hand on its own:** it would undo 179 (r2 would show it).
4. The DBA runs `docs/finance/deployment/2026-11-25_accountant_settings.sql`: books from 25/11 (Cairo midnight), VAT and withholding suspended, commissions settled. It prints the values before and after.
5. Optional hardening: `db-security/ledger_roles.sql`, then switch `DATABASE_URL` to `soul_app`.

## 2. Go-live in the app: Financial System → Ledger controls → "Go-live"
Each step is done by a CEO or financial manager from their own login; the database refuses any other order and logs each step.
1. **Approve revenue presentation** (gross).
2. **Approve taxes** (suspended). The same person may approve both, for example the owner.
3. **Record the approved policy.** This must be a *different* CEO or financial manager, citing the basis (for example "Accountant's approval confirmed by the owner, 25 Nov 2026").
4. Type a reason (for example "Owner's instruction, 25 Nov 2026"), then **switch posting on**.
5. **Sync changes:** posts everything from 25/11 to now. From then on the nightly job (04:30 Cairo) posts each day's new activity and reconciles. A changed booking or payment shows in Data health until someone presses **Sync changes** again; the replacement is logged under their name.
6. **Opening balances:** when the owner gives the bank and cash figures as at 25/11, they are posted as one opening entry (`ledger-migration.js`, `--opening balances.json`).

## 3. Parallel month, then reports (Phases 5–6)
- Until the end of December, reports stay on the live calculation while the ledger runs and reconciles nightly (Ledger controls → Reconciliation; Data health).
- After a clean month, a CEO or financial manager presses **Switch reports to the ledger**, with a reason. The statements then say "Built from the stored ledger".

## 4. Operate (Phase 7)
`FINANCIAL_OPERATIONS.md`: the daily Data health check, Sync changes or Reconcile now, the month-end step and the monthly review.

## Rollback
- Reports back to the live calculation, then posting off: both from the same section.
- Full removal before real use: `rollback_179` → `178` → `177` → `176` (→ `175_*`). Each refuses the wrong order.
