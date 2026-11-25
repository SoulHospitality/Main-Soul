# Historical Migration and Parallel Run: Runbook (Phases 4 and 5)

**For:** the DBA and finance lead who run it, and the accountant and owner who accept it. **Status (2026-11-25):** tooling built and tested on synthetic data; **nothing has been imported**. Method: `DATA_MIGRATION_PLAN.md` Steps 2–4. Tool: `Server/scripts/ledger-migration.js` (library `src/lib/accounting/historicalMigration.js`).

## Gates (all required before `execute`)
| # | Gate | Evidence |
|---|---|---|
| 1 | Migrations 175/176 deployed; restricted role and identity key set up | `DEPLOYMENT_READINESS.md` §9 |
| 2 | Live checks 0–6 reviewed; issues resolved or accepted in writing | `DATA_MIGRATION_PLAN.md` Step 0 |
| 3 | An **approved** policy (two verified approvals with written references) in force for the whole range | Ledger controls page |
| 4 | Historical commission method approved | `ACCOUNTANT_DECISION_TRACKER.md` |
| 5 | The owner's written approval of this run (range, policy version) | Sign-off below |

**Treatment check.** The importer copies the engine's amounts exactly, so it runs only if the approved policy matches how the engine books history today (`revenue_presentation = gross`, `vat_base = fee_plus_cleaning`). If the accountant decides otherwise (for example net revenue, or VAT on the fee only), it stops with `METHOD_MISMATCH`. A transformation, or dated restating adjustments, must then be specified and approved first. This is never improvised.

## Phase 4: Historical migration
1. **Backup**, and record its id.
2. **Dry run (reads only):** `DATABASE_URL=<target> node scripts/ledger-migration.js plan --from 2026-10-01 --to <last closed day> --policy <version>`.
   - **Required:** exit 0, `balanced: true`, `errors: 0`.
   - Review `plan.json`: entry counts by type, and adapter notes (sign flips, two-sided lines split). Each note is a representation change; no amount changes.
   - **Opening balances** before 2026-10-01: only from the accountant's signed figures (`--opening balances.json`). Otherwise none.
3. **Switch posting on** (verified admin and reason; `db-security/README.md`). Posting does nothing until entries are posted.
4. **Import:** `… execute --from … --to … --policy <version> --actor <staff id> --confirm-host <host> --execute`.
   - It runs one transaction per month and is resumable: re-running skips what is already posted.
   - It refuses without `--execute`, or when `--confirm-host` does not equal the target host.
   - It reconciles automatically afterwards.
5. **Reconcile:** `… reconcile --from … --to …`. The pass is `clean: true`:
   - every reference entry `matched`;
   - account differences ≤ 0.01;
   - no `amount_break`, `reference_only` or `ledger_only`.
6. **Investigate** each difference (CSV row by row): fix the source, or re-run `sync`. Rounding rows (≤ 0.01) are listed and accepted individually.
7. **Acceptance** (sign-off below). Evidence: the `plan`, `run` and `reconcile` JSON and CSV files.

## Phase 5: Parallel operation (at least one full month)
- **Nightly:** `… sync …` for the open months.
  - It posts new reference entries.
  - Where a booking or payment changed, it reverses the posted entry and posts a linked replacement (history kept).
  - Then it runs `reconcile`. Closed (frozen) months never change.
- **Reports** still come from the existing engine throughout.
- **Compare each day:** revenue, expenses, commissions, VAT, deposits and refunds. That is the account level of `reconcile` (the `accounts` list), plus the Ledger controls page.
- **Month end:**
  - close the month in the Financial System;
  - run `reconcile` for that month; it must be `clean`;
  - the accountant reviews the trial balance, P&L and balance sheet from both sources.
- **Exit:** a whole month with no unexplained difference, and the owner's and accountant's sign-off.

## Verified so far (local, synthetic)
- **`rehearsal/local/migration-test.js`, 31/31 (PGlite):**
  - treatment check;
  - dry run proves account-by-account equality and writes nothing;
  - refusals: switch off, draft policy, mismatched treatment, plan errors, imbalance;
  - import, and re-run without duplicates;
  - clean reconciliation;
  - booking edit → breaks → sync replaces exactly the changed entries → clean;
  - a stray ledger entry is caught;
  - opening balances only when supplied.
- **`rehearsal/local/migration-cli-real-test.js`, 14/14 (real PostgreSQL 17.5):**
  - the CLI as run by the DBA: guard refusals (exit 2), import, reconciliation;
  - an edit in a frozen month changes nothing;
  - an open-month edit is detected and synced;
  - evidence files contain no key or URL.

## Sign-off (to be completed by the people named, in writing; never pre-filled)
| Step | Name | Date | Reference |
|---|---|---|---|
| Owner approves the run (range, policy) | | | |
| Migration accepted (reconciliation clean) | | | |
| Parallel month completed and accepted | | | |
