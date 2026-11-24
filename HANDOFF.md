# HANDOFF: Financial reconstruction

**Updated:** 2026-11-24 (Phase 5A) · **Branch:** `feature/finance-ledger`.
- Pushed: up to `f743ac8`.
- Committed locally, **not pushed**: the Phase 5A report-fix commit.

**Decision: NO-GO.** Not merged into `main` (`main` is still `ff782cd`), not deployed, ledger posting **off**, no historical import, reports not switched to the stored ledger, production untouched.

## Commits on the branch
| Commit | State | Content |
|---|---|---|
| `6955687` | pushed | Foundation: documents, accounting library, migrations 175/176, decimal.js 10.6.0 |
| `b9d56fe` | pushed | Migration 175 hardening, D-01 pack revision |
| `9e74bb4` | pushed | Readiness: database posting controls, rehearsal kit, live check 0, `DEPLOYMENT_READINESS.md` |
| `f743ac8` | pushed | HANDOFF and readiness report with the commit hash |
| Phase 5A report fixes (this commit) | **local only** | `ledgerEngine.js`: DEF-PL-01, DEF-BS-01, DEF-CLOSE-01; regression tests; test registration; report-validation docs; this HANDOFF |

## What the Phase 5A commit contains
- **`Server/src/lib/finance/ledgerEngine.js`:**
  - **DEF-PL-01:** the P&L over a range with closed months included only open months. It is now built from operating activity.
  - **DEF-BS-01:** the balance sheet did not balance after a month close. Current-year earnings are now the open P&L.
  - **DEF-CLOSE-01:** a close with opposite-signed balances dropped lines and was unbalanced. It now closes on the other side and always balances.
- **`Server/src/lib/finance/ledgerEngine.regression.test.js`:** 11 tests. Each defect was reproduced on `f743ac8` before fixing.
- **`Server/package.json`:** the regression test, plus three existing finance test files that were never run (`applyCancellation`, `cancelSettlement`, `paymentInput`), added to `npm test`.
- **`docs/finance/FINANCIAL_REPORT_VALIDATION.md`, `docs/finance/ACCOUNTING_ENGINE_VALIDATION.md`:** inaccurate claims corrected:
  - the P&L had been marked validated when it wasn't;
  - live check 6 was said to detect DEF-CLOSE-01, which it cannot, because closing entries are regenerated live and never frozen.

**Effect once deployed:** the Financial System's displayed P&L, balance sheet and past closing entries change wherever a month has been closed. That is the intended correction, and it needs its own before/after comparison on the restored copy (old code vs new code). It is not caused by the migrations.

## Not in this commit: uncommitted ledger work (under review)
- `Server/supabase/migrations/176_ledger_core.sql`
- `Server/src/lib/accounting/posting.js`
- `Server/src/lib/accounting/engineAdapter.js`
- The rehearsal kit changes and local PGlite suites (`docs/finance/rehearsal/…`)
- `docs/finance/DEPLOYMENT_READINESS.md`, `POSTING_CONTROLS_AUDIT.md`, `FINANCIAL_INTEGRATION_MATRIX.md`, `TESTING_AND_VALIDATION.md`, `D01_ACCOUNTANT_REVIEW_PACK.md`

The pre-commit review's ledger-control findings (H1–H3, M1–M8, L1–L10) are being worked on in Phase 5B.

`docs/security/NPM_AUDIT_REMEDIATION.md` is separate and untracked.

## Tests at this commit
- `npm test`: 134 tests, 133 pass. The single failure is `hrRules.test.js:362` (HR: commit `ad8515f` made operations staff subject to office attendance; the test was not updated). That code is unchanged.
- The regression tests pass 11 of 11.

## Outstanding before any production deployment
1. Live checks 0–6.
2. The restored-copy rehearsal.
3. Backup and restore validation.
4. A restricted posting role.
5. The owner's approval.

**Posting and historical import** additionally need:
1. A written EAS 48 decision.
2. A separate written VAT-base decision.
3. An approved historical commission-rate methodology.
