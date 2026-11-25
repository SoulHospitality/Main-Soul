# Ledger Activation and Reporting Migration: Runbook (Phase 6)

**For:** the owner, accountant and DBA. **Status (2026-11-25):** built and tested on synthetic data; **not activated anywhere.** Posting is off, and reports read the existing calculation.

## What it adds
- **Migration 177:** the report-source setting `ledger_reports`: `engine` (default) or `ledger`. The database guards it like the posting switch:
  - it cannot be deleted or renamed;
  - every change needs a **verified** active admin and a written reason, and is kept in the permanent control log;
  - `ledger` is refused while posting is off;
  - posting cannot be switched off while reports read the ledger.
- **`lib/accounting/reportSource.js`:** builds the trial balance, P&L and balance sheet from the stored ledger with **the same statement builder** as today. Month-end closing entries are generated exactly as the engine does, so the two sources compare line for line.
- **`/financial-system/reports`:** returns `source`. The statements show "Built from the stored ledger" when it applies, and Ledger controls shows the source and who switched it.
- **What still reads the existing calculation:** the other Financial System pages (Today, outstanding, owners, cash flow). That is listed under Phase 7.

## Preconditions (all in writing)
1. Phase 4 accepted: the migration reconciliation is clean (`HISTORICAL_MIGRATION_RUNBOOK.md`).
2. Phase 5 accepted: at least one full month of parallel operation with no unexplained difference, and the month-end close reconciled.
3. The owner's written authorisation to activate, naming the date.

## Activation
1. **Backup**, and record its id.
2. **Final sync and reconcile** for all open months: `ledger-migration.js sync …`, then `reconcile …`. It must be `clean`.
3. **Switch reports to the ledger** (a verified admin, from a maintenance shell):
   ```js
   await require('./src/lib/accounting/reportSource').setReportSource('ledger', { actorId: <admin id>, reason: '<authorisation ref>' })
   ```
4. **Validate** in the Financial System:
   - trial balance, P&L and balance sheet for each open month match the figures signed off in Phase 5;
   - the statements show "Built from the stored ledger";
   - Ledger controls shows the switch, with your name and the reason.
5. **Month end, from now on:** close the month as usual, and the closing entry comes from the stored ledger. Corrections are made as reversals and linked replacements, never edits.

## Rollback (tested)
- **Reports back to the calculation**, at any time, data untouched: `setReportSource('engine', { actorId, reason })`. It is verified and logged.
- **Full removal**, before any real posting only: `rollback_177.sql` (refuses while reports read the ledger), **then** `rollback_176.sql` (refuses while 177 is installed).

## Verified so far (local, synthetic)
**`rehearsal/local/activation-test.js`, 31/31:**
- **Guards:** default `engine`; installation logged; cannot be deleted or renamed; refused while posting is off; refused unverified, for a non-admin, or without a reason.
- **Switch:** a verified admin's switch is logged with name and reason.
- **Parity:** trial balance (balances and turnover), P&L and balance sheet are identical from engine and ledger after import, and after closing November. The closing entry is identical and balanced.
- **Corrections:** a reversal shows in reconciliation; sync re-posts it under a new version key and the books reconcile. Balances, P&L and balance sheet stay identical. Turnover exceeds the engine's by exactly the reversal and re-post (the audit trail).
- **Endpoints:** the reports endpoint and Ledger controls report the source.
- **Rollback:** back to `engine` (logged), then `rollback_177` → `rollback_176`, in the enforced order.

The deployment rehearsal now covers 175, 176 and 177: `rehearsal.js` 33/33 on PGlite and on real PostgreSQL 17.5 (r2 18/18); `runbook-real.js` 9/9.

## Sign-off (completed by the people named; never pre-filled)
| Step | Name | Date | Reference |
|---|---|---|---|
| Owner authorises activation | | | |
| Statements validated after activation | | | |
