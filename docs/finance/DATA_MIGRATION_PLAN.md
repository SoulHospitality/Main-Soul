# Data Migration Plan, Reconciliation and Rollback

**Rules:**
- Every change is additive. No table is dropped, no existing financial row is changed, and no past migration is rewritten.
- The existing calculation (`buildJournal()`, plus the frozen copies in `financial_posted_entries`) stays the reference and keeps feeding every report until cutover is approved.
- Anything destructive or ambiguous stops for approval.

## Gates: nothing below Step 2 runs until all three are met
1. **D-01 written approval** from the accountant (see `D01_ACCOUNTANT_REVIEW_PACK.md`), entered as an *approved* `ledger_policies` row.
2. **Live check results received and reviewed** (Step 0). The person who ran them signs off.
3. **The owner's explicit approval** of this plan for the specific migration run.

## Step 0: Live data checks (read-only), not yet run
The SQL scripts in `docs/finance/live-checks/` (check 0 for the deployment state, checks 1–6 for data quality) are run by an authorised person under a SELECT-only role. No application endpoint is involved.

Results are recorded below and in `DEPLOYMENT_READINESS.md` §2 once received. **Go/no-go:**
- USD stays without a rate (check 2), duplicate payment references (check 3) and unbalanced frozen months (check 6) must each be resolved, or explicitly accepted in writing, before Step 2.
- The lists from checks 1 and 5 become review queues.

| Check | Result received | Outcome |
|---|---|---|
| 1 Amount quality | not yet | — |
| 2 USD rates | not yet | — |
| 3 Duplicate refs | not yet | — |
| 4 cash_ledger | not yet | — |
| 5 Commission changes | not yet | — |
| 6 Frozen balance | not yet | — |

## Step 1: Additive schema (built in Phase 2, empty, posting off)
- **Migration 175:** commission snapshots (D-12).
  - New and newly confirmed reservations capture the rates the engine actually applies (company %, including the 20% default and the owner-booked rate; tenant deduction %; salesperson %), the raw unit and salesperson values, the calculation basis and the effective date.
  - Snapshots can only be written by the trigger or by a correction that the trigger logs.
  - Historical confirmed reservations are **not backfilled**. They appear in the `reservation_commission_review` view as `needs_review`.
  - Corrections are possible only through an explicit, logged correction (`reservation_commission_corrections`).
- **Migration 176:** the ledger core: `ledger_accounts` (seeded from the current chart), `ledger_policies`, `ledger_periods`, `ledger_entries`, `ledger_lines` (`numeric(19,4)`) and `ledger_events`.
  - Database triggers block edits and deletes. The only permitted change is marking an entry reversed, once.
  - A deferred constraint enforces balance.
  - `financial_settings.ledger_posting = 'off'`.

## Step 2: History into the ledger (blocked by the gates)
1. **Closed months:** each frozen or adjustment entry in `financial_posted_entries` becomes one `ledger_entries` row with:
   - `origin = 'migrated'`;
   - the same date;
   - idempotency key `frozen:{year_month}:{entry_id}`.

   Amounts are copied exactly as saved, with no recalculation.
2. **Open months:** `buildJournal()` output for the open period is posted as migrated entries, keyed by the builder's entry id (`B-…`, `P-…`, `E-…`), under the approved D-01 policy version.
3. **Before FINANCE_BOOKS_START (2026-10-01):** opening balances only, as one opening entry.
4. **Repeatability:** the migration runs in a transaction per month and skips existing idempotency keys, so re-running it creates no duplicates. Each run writes a run record: who ran it, when, the policy version, and entry and line counts.

## Step 3: Reconciliation method
Run for every period after Step 2, and again nightly during the parallel run (Step 4). It compares the following, per period and per account:
- **Reference:** the trial balance from `buildJournal()` for open months, or the frozen copies for closed months.
- **New:** `trialBalance()` from `ledger_lines`.

| Level | Compared | Pass |
|---|---|---|
| Totals | Count of entries, total debits, total credits | Equal |
| Account | Debit, credit and net per account per period | Equal to 0.00, except the rounding bucket |
| Entry | Each reference entry id has exactly one ledger entry with the same lines | Every entry is matched |
| Subledger | Owner payable per owner, guest receivable per reservation, cash per account | Equal |

Each difference is sorted into one of these buckets:
- **matched**;
- **rounding:** at most 0.01 per entry, caused by the half-piaster float behaviour described in `MONEY_AND_ROUNDING_POLICY.md`, and listed individually;
- **amount break**;
- **timing break:** the same amount in a different period;
- **ledger only**;
- **reference only**.

Any amount break, ledger-only or reference-only line blocks cutover until it is explained and signed off. The output is `docs/finance/reconciliation/<period>-<run date>.csv`, plus a summary.

## Step 4: Parallel run (one full month)
New activity posts through `ledger_events`, while the reports still read the reference. The nightly reconciliation (Step 3) runs on both. Cutover requires a whole month with no unexplained break and the owner's approval.

## Step 5: Legacy tables after cutover
- `cash_ledger`: stop writing to it and keep it read-only (D-13).
- `commissions` (unused): leave untouched.
- Integer EGP columns on the guest side: convert explicitly when building events; the columns themselves are not changed.

## Rollback plan
| Stage | Rollback |
|---|---|
| After Step 1 (now) | Nothing depends on the new tables. Leave them empty, or drop them in a new reviewed migration. No operational data is involved. |
| During Step 2 or 3 | Set `ledger_posting = 'off'`. Migrated entries are reversed (reversal entries, never deletes), or the empty-ledger state is restored from a pre-run database backup taken immediately before the run. Reports were never switched, so nothing visible changes. |
| During the parallel run | Turn posting off. Reports still read the reference. Investigate the breaks and re-run. |
| After cutover | Switch reports back with one setting (`LEDGER_SOURCE=computed`). The reference engine is kept and tested until at least one year-end close on the new ledger. |

**Backup requirement:** take a point-in-time Supabase backup immediately before each Step 2 run, and record its id in the run record.
