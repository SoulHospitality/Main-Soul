# HANDOFF: Financial reconstruction

**Date:** 2026-11-23 · **Branch:** `feature/finance-ledger` (from `main` at ff782cd) · **Nothing committed or pushed. The owner's explicit approval is required first.**

## Git isolation
All earlier work (operations, chatbot, cleaner, leave fixes) was already committed and pushed on `main` before this branch was created. Nothing was stashed, reset or discarded.

The only changes on this branch are the finance files below:
- 2 modified: `Server/package.json`, `Server/package-lock.json`.
- New, untracked:
  - `HANDOFF.md`;
  - `Server/src/lib/accounting/`;
  - migrations 175 and 176;
  - `docs/finance/`.

## Phase 1: audit and planning (accepted)
These are in `docs/finance/`:
- `FINANCIAL_SYSTEM_AUDIT.md`
- `ACCOUNTING_STANDARDS_AND_POLICY_RESEARCH.md`
- `ACCOUNTING_DECISIONS_REGISTER.md`
- `ACCOUNTING_ARCHITECTURE.md`
- `ACCOUNTING_ERD.md`
- `FINANCIAL_EVENT_MAPPING.md`
- `FINANCIAL_PERMISSIONS_MATRIX.md`
- `FINANCIAL_REPORTING_GAP_ANALYSIS.md`

## Phase 2: foundation built, inactive
| Item | Files | State |
|---|---|---|
| Decimal money layer | `Server/src/lib/accounting/money.js`, decimal.js **10.6.0** pinned. It has no dependencies of its own; the only copy in the tree is the one at the top level. | Used only by new code |
| Commission snapshots (D-12, approved) | `migrations/175_commission_snapshots.sql`, `lib/accounting/commissionSnapshots.js`, `commissionCalc.js` | Live after deploy. Captures rates on confirmation from then on. No backfill; historical stays are listed in `reservation_commission_review`. |
| Stored double-entry ledger | `migrations/176_ledger_core.sql`, `lib/accounting/posting.js` | Tables are empty. `ledger_posting = 'off'`. Nothing calls posting. |
| Reconciliation engine | `lib/accounting/reconcile.js` | Library only |
| Live checks (read-only SQL) | `docs/finance/live-checks/` (README and 01–06) | **Not run.** Waiting for an authorised person. |
| D-01 accountant pack | `docs/finance/D01_ACCOUNTANT_REVIEW_PACK.md` | Waiting for the accountant |
| Strategy documents | `DATA_MIGRATION_PLAN.md` (migration, reconciliation, rollback), `MONEY_AND_ROUNDING_POLICY.md`, `TESTING_AND_VALIDATION.md` | Ready for review |

**Not changed:**
- `lib/finance/ledgerEngine.js` and every report: these remain the reference implementation and the live output.
- Existing financial rows.
- Prior migrations.

## Tests
- `npm test`: 107 tests, **106 pass and 1 fails**. The failure is `hrRules.test.js:362` ("fills absences by staff id…", expected 1 absence, got 2). That code is identical to the last commit, so the failure is in committed code and is not caused by this branch. It needs a separate fix on `main`.
  - The 19 new money tests all pass.
- PGlite database tests (scratchpad, not in the repository):
  - `ledger-test.js`: 29 of 29 pass.
  - `livechecks-test.js`: all six scripts run. The 0.01 imbalance was detected, and a write inside a read-only transaction was refused.

## npm audit (pre-existing, not from this phase)
There are 12 production advisories: 1 critical, 6 high and 5 moderate. The affected packages are xlsx, nodemailer, qs, body-parser, proxy-addr, engine.io, socket.io-parser, uuid, csv-parse and brace-expansion. None involves decimal.js. They have not been fixed here because some fixes need breaking upgrades, which should be done as their own task.

## Blockers before any financial data changes
1. **D-01:** written approval from the accountant, under the Egyptian Accounting Standards. Until then, historical migration, posting and report switching all stay blocked.
2. **Live check results:** the six scripts must be run, and their results recorded in `DATA_MIGRATION_PLAN.md` Step 0.
3. **The owner's approval** for each migration run, after reviewing the strategy, the reconciliation method, the rollback plan and the check results.
4. **Commit and push approval** for this branch.

## Next (after the blockers)
- Event → posting rules for each event, read from the approved policy.
- A dry-run migration on a restored production copy, then reconciliation to zero unexplained breaks.
- A one-month parallel run, then cutover behind `LEDGER_SOURCE`.
- Later documents: `CHART_OF_ACCOUNTS.md` (final, after D-01), `ACCOUNTING_POLICY_MANUAL.md`, `ACCOUNTING_POSTING_RULES.md`, `RECONCILIATION_GUIDE.md`, `MONTH_END_CLOSING_GUIDE.md`, `FINANCIAL_API_REFERENCE.md`.

## Skills used
- `gl-reconciler:gl-recon`: the reconciliation buckets.
- `month-end-close`: the structure of the close checklist.
- `charlie`: kept for the management-report phase.
