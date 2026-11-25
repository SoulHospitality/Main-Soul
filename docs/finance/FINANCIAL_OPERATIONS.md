# Financial Operations: Monitoring and Month End (Phase 7)

**For:** the finance team and the owner. **Status (2026-11-25):** built and tested on synthetic data. It starts working by itself once the stored ledger is live (posting on). Until then it does nothing and flags nothing.

## What runs on its own
- **Nightly at 04:30 Cairo time** (`jobs/ledgerReconciliation.js`): the stored ledger is reconciled against the live calculation for the previous and current month.
  - Each result is kept permanently (migration 178, `ledger_reconciliation_runs`). Results can't be changed, deleted or truncated.
  - A run with differences is also written to the server log as an error.
- **Data health** (`Financial System → Data health`): a high-priority item "Stored ledger not reconciled" appears when the latest run is missing, has differences, or is older than 36 hours. It links to Ledger controls.

## What people do
| When | Who | What |
|---|---|---|
| Daily | Finance | Look at the Data health badge. If the ledger item is there, open **Ledger controls → Reconciliation** |
| On a difference | Finance | Export the run (Excel) and read each row. **Amount** and **timing** breaks: fix the source record, then the DBA runs `ledger-migration.js sync` during the parallel period, or a reversal and linked replacement after activation. **Ledger only / reference only:** investigate; never delete. Then press **Reconcile now**; it must come back clean |
| Month end | Finance | **Close month** now includes "Stored ledger reconciled" once the ledger is live. The month closes only when every step is done |
| Monthly | Accountant | Review the month's trial balance, P&L and balance sheet, the reconciliation history, and the control log (posting switch and report source changes, with names and reasons) |

## Audit trail (what is permanent)
- **Ledger entries:** corrections are reversals and linked replacements, never edits.
- **The control log:** every change to the posting switch and the report source, with the verified person and the reason.
- **Approvals:** recorded by each approver in their own signed step.
- **Reconciliation runs:** this phase.

## Dashboards
**Ledger controls** shows:
- the posting switch and the report source, and who changed them;
- the go-live gates and the policies with their approvals;
- reconciliation history, with **Reconcile now**;
- ledger totals, ledger months and the control log.

**Commission review** shows rate-snapshot status. The statements show which source they were built from, and warn about accounts missing from the chart.

## Not done yet (needs real operation first)
- **Pages that still use the live calculation after activation:** Today, outstanding, owners, cash flow and tax. Moving them follows the same pattern as the statements (Phase 6). It should be done after a real parallel month shows which ones matter.
- **Performance monitoring on real volumes:** for example, how long the nightly reconciliation takes with a year of history. It can only be measured on real data.

## Verified (local, synthetic)
**`rehearsal/local/monitor-test.js`, 19/19:**
- nothing runs or is flagged while posting is off;
- "never reconciled" is flagged once live;
- a clean nightly run clears it;
- an open-month edit is recorded with its accounts and sample rows, and flagged;
- the history is permanent (no update, delete or truncate);
- a run older than 36 hours is flagged as stale;
- Reconcile now: finance roles only, and records who ran it;
- Ledger controls lists the runs;
- the Data health endpoint includes the check, and it clears after the fix;
- the job is started with the server.

The deployment rehearsal now applies and rolls back 175–178 in order: 33/33 on PGlite and on real PostgreSQL 17.5, r2 18/18.
