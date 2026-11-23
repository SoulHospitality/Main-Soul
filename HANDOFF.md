# HANDOFF: Financial reconstruction

**Date:** 2026-11-23 · **Branch:** `feature/finance-ledger` (from `main` at ff782cd), pushed to origin. Not merged into `main`.
**Production deployment: BLOCKED.** It needs the owner's explicit approval after `docs/finance/DEPLOYMENT_READINESS_CHECKLIST.md` is complete.

## Commits on the branch
| Commit | Content |
|---|---|
| `6955687` | Phase 1 and 2 foundation: the 9 Phase 1 documents plus the Phase 2 documents, the accounting library, migrations 175 and 176, decimal.js 10.6.0 and HANDOFF |
| follow-up (this commit) | Migration 175 hardening, D-01 pack revision, deployment-readiness checklist, updated documents and HANDOFF |

**Not on this branch:**
- `docs/security/NPM_AUDIT_REMEDIATION.md` was written but left uncommitted, because it is not part of the finance work.
- No dependency upgrades.

**Merging is deploying:** the server applies new migrations when it starts. Merging into the deployed branch therefore runs migrations 175 and 176 on the next restart.

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
- `DATA_MIGRATION_PLAN.md`

## Phase 2: foundation (accepted), inactive
| Item | Files | State |
|---|---|---|
| Decimal money layer | `lib/accounting/money.js`, decimal.js 10.6.0 pinned | Used only by new code |
| Commission snapshots (D-12) | `migrations/175_commission_snapshots.sql`, `lib/accounting/commissionSnapshots.js`, `commissionCalc.js` | **Not deployed.** Validated (see below). |
| Stored double-entry ledger | `migrations/176_ledger_core.sql`, `lib/accounting/posting.js` | Not deployed. Empty, posting off, no callers. |
| Reconciliation | `lib/accounting/reconcile.js` | Library only |
| Live checks | `docs/finance/live-checks/` | **Not run.** Waiting for an authorised person. |
| D-01 pack | `docs/finance/D01_ACCOUNTANT_REVIEW_PACK.md` | Revised. Ready to send. |
| Readiness | `docs/finance/DEPLOYMENT_READINESS_CHECKLIST.md` | Open items listed |

## Migration 175 validation (follow-up commit)
Review found and fixed:
1. **The snapshot did not record the rate actually applied.** It now stores the applied company % exactly as `calcReservationFinancials` decides it:
   - the 20% default when a unit has none;
   - the owner-booked % in mode C;
   - the tenant deduction % (modes B and C, not owner-booked);
   - the salesperson %;
   - the raw values, the deciding flags and the basis.
2. **`commissionCalc.splitFromSnapshot` read the wrong field** and would have refused every real snapshot. It now reads the stored shape and follows the engine's steps. A parity test across 2,000 random cases shows the only differences are the known ≤ 0.01 float rounding of the reference engine.
3. **A snapshot could be written by hand,** including an invented one on a historical stay. It is now blocked on insert and on update, and the status and time columns are protected.
4. **Corrections:**
   - the database trigger now writes the log itself, and refuses a correction without who and why;
   - the log is append-only;
   - only an active admin can correct, and the approver must be a different person.
5. **New review flags:** changes to the salesperson or owner flag, re-confirmation after cancellation, a missing unit, and stays created before go-live but confirmed afterwards.

Migration 175 has never been applied anywhere, so the file was revised in place rather than superseded.

**Known, by design:** current reports still use live rates until the ledger is switched on. The snapshot records the rate but does not change any figure shown.

## D-01 pack revision
- The worked examples were re-checked: the debits and credits balance, and commission is credited once. The only thing shown twice under gross is the owner's part, as revenue and as an expense, which is how gross reporting is meant to work.
- Presentation under EAS 48 is now separated from the VAT determination, with a separate signed table for each.
- The policy design has two settings, `revenue_presentation` and `vat_base`, neither with an unapproved default.

## Tests
- `npm test`: 109 tests, **108 pass and 1 fails**.
  - The 21 money tests all pass, including the parity test.
  - The failure is `hrRules.test.js:362`. It is in committed HR code and also fails on `main`; it needs its own fix there.
- PGlite: `ledger-test.js` passes 42 of 42; `livechecks-test.js` passes. Both are in the scratchpad, not the repository.

## Security
`docs/security/NPM_AUDIT_REMEDIATION.md` covers all 12 findings.
- **Critical (proxy-addr):** not reachable with `trust proxy = 1`. Fix by moving to express 4.22.3 with a lockfile refresh.
- **Real exposure:**
  - xlsx: an attendance upload by HR staff;
  - DoS flaws in body-parser, qs, engine.io and socket.io-parser.
- **Also found:** the public inquiry email puts unescaped user input into its HTML.
- None of this has been fixed yet. Each fix should be a separate change.

## Remaining blockers
1. Six live checks: run and record the results.
2. Production dry run of migrations 175 and 176 on a restored copy, plus a rehearsed rollback (checklist §2–4).
3. A backup verified and taken immediately before deployment.
4. **D-01** decisions 1 and 2, signed by the accountant. These are needed before posting, import or report switching, not before deploying 175 and 176.
5. A method agreed for establishing historical commission rates (checklist §6).
6. **The owner's explicit approval to deploy.**

## Next steps
1. Send the D-01 pack to the accountant.
2. An authorised person runs the live checks.
3. Dry run on a restored copy, then complete the checklist.
4. Separately: the non-breaking security batch, then xlsx, then nodemailer. Also fix the HR test on `main`.
5. After D-01: posting rules per event, a dry-run migration with reconciliation, a one-month parallel run, then cutover behind `LEDGER_SOURCE`.

## Skills used
- `gl-reconciler:gl-recon`: the reconciliation buckets.
- `month-end-close`: the structure of the close checklist.
- `charlie`: kept for the management-report phase.
