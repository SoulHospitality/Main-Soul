# HANDOFF: Financial reconstruction

**Updated:** 2026-11-24 (end of Phase 5B) · **Branch:** `feature/finance-ledger`.
- **Pushed:** up to `3caa574` (report fixes), plus the Phase 5B commit described below.

**Decision: NO-GO.** Not merged into `main` (`main` is still `ff782cd`), not deployed, posting **off**, no historical import, reports not switched to the stored ledger, production untouched.

## Commits
| Commit | State | Content |
|---|---|---|
| `6955687` | pushed | Foundation |
| `b9d56fe` | pushed | Migration 175 hardening, D-01 pack |
| `9e74bb4` | pushed | Readiness controls, rehearsal kit, check 0 |
| `f743ac8` | pushed | HANDOFF and readiness hash |
| `3caa574` | pushed | `ledgerEngine.js` (DEF-PL-01, DEF-BS-01, DEF-CLOSE-01), `ledgerEngine.regression.test.js`, `package.json` (test registration), `FINANCIAL_REPORT_VALIDATION.md`, `ACCOUNTING_ENGINE_VALIDATION.md`, `HANDOFF.md` |

## Phase 5B (committed and pushed)
Fixes for the pre-commit review's findings, each with regression tests (details in `docs/finance/DEPLOYMENT_READINESS.md` §3b):
- **Migrations:**
  - **H1:** TRUNCATE guards on every ledger table, `financial_settings` and the correction log.
  - **H2:** the switch row cannot be renamed, or have a row renamed into it.
  - **M1:** one reversal and one replacement per entry (unique indexes).
  - **M2:** reversals keep the original's (possibly retired) policy.
  - **M3:** the policy in force is enforced; one approved policy per date.
  - **M6:** used accounts are fixed.
  - **M7:** approvers are validated (admins, not the recorder).
  - **L8:** custom accounts are synced to the ledger chart.
- **`posting.js`:**
  - **L1:** the fingerprint covers every material field.
  - **M2/M3:** the policy is resolved by the same rules as the database.
  - **L6:** `IDEMPOTENCY_RACE` instead of a crash.
  - **L7:** reversals copy the original EGP amounts exactly.
- **`engineAdapter.js`:**
  - **L2:** two-sided lines are split, not netted; a two-sided USD line is refused.
  - **L3:** unit dimension.
  - New `engineAdapter.test.js`.
- **`ledgerEngine.js` and `reportBuilder.js`:**
  - **L4:** the close is independent of the contra flag.
  - **L5:** postings to 303000 are kept.

  These change displayed reports only where those cases occur.
- **Docs:**
  - **M5/M8:** check 6 claim removed; the runbook separates the migration effect (same code: identical) from the engine-fix effect (old vs new code: explained differences); `compare-books.js` can run old code and outputs closes month by month.
  - **H3:** documented as attribution, not authentication.
  - **L9:** rehearsal evidence goes outside the repo.
- **L10:** a **genuine multi-session test** on a local real PostgreSQL 17.5 server: `rehearsal/local/concurrency-test.js`, 7/7.

Files:
- **Modified (19 vs `3caa574`):**
  - `Server/package.json`
  - `Server/src/lib/accounting/posting.js`
  - `Server/src/lib/finance/ledgerEngine.js`
  - `Server/src/lib/finance/ledgerEngine.regression.test.js`
  - `Server/src/lib/finance/reportBuilder.js`
  - `Server/supabase/migrations/175_commission_snapshots.sql`
  - `Server/supabase/migrations/176_ledger_core.sql`
  - `docs/finance/ACCOUNTING_ENGINE_VALIDATION.md`
  - `docs/finance/D01_ACCOUNTANT_REVIEW_PACK.md`
  - `docs/finance/DEPLOYMENT_READINESS.md`
  - `docs/finance/FINANCIAL_REPORT_VALIDATION.md`
  - `docs/finance/TESTING_AND_VALIDATION.md`
  - `docs/finance/rehearsal/README.md`
  - `docs/finance/rehearsal/compare-books.js`
  - `docs/finance/rehearsal/local/ledger-test.js`
  - `docs/finance/rehearsal/local/rehearsal.js`
  - `docs/finance/rehearsal/r2_verify_structure.sql`
  - `docs/finance/rehearsal/r3_behaviour.sql`
  - `docs/finance/rehearsal/rollback_176.sql`
  - plus this `HANDOFF.md`.
- **New:**
  - `Server/src/lib/accounting/engineAdapter.js`
  - `Server/src/lib/accounting/engineAdapter.test.js`
  - `docs/finance/FINANCIAL_INTEGRATION_MATRIX.md`
  - `docs/finance/POSTING_CONTROLS_AUDIT.md`
  - `docs/finance/rehearsal/local/{concurrency-test,engine-fixtures,engine-validation,security-test}.js`
  - `docs/finance/rehearsal/evidence/{local-rehearsal-2026-11-24-phase5,local-rehearsal-2026-11-24-phase5b,real-postgres-concurrency-2026-11-24}.json`
- **Separate, untracked, not finance:** `docs/security/`.

## Test results (synthetic data, local)
| Suite | Result |
|---|---|
| `npm test` | 143 tests, **142 pass**; the 1 failure is the HR test (`ad8515f` changed the rule, the test was not updated) |
| `ledger-test.js` (PGlite) | 119 / 119 |
| `engine-validation.js` | 43 / 43 |
| `security-test.js` | 20 / 20 |
| `rehearsal.js` | 26 / 26 (r2 15/15, r3 41/41) |
| `livechecks-test.js` | pass |
| `concurrency-test.js` (**real PostgreSQL 17.5**, separate connections) | 7 / 7 |

**Concurrency:** genuinely tested on a local real PostgreSQL 17.5 server. **Not** yet on Supabase or the restored copy. PGlite results remain single-connection.

## Unresolved blockers
1. **H3: session-bound identity.** Staff ids given to the database are claims by the shared application connection; the database cannot prove who is acting. This needs the restricted role plus verifiable signed identity claims. Until then: attribution only. Required before posting.
2. **Restricted posting role.** The owner role can disable triggers (shown on real Postgres); a non-owner role cannot. Required before posting.
3. **Production checks 0–6**, the **restored-copy rehearsal** (including the old-vs-new-code engine comparison, the concurrency and role checks, and rollbacks), and **backup/restore validation.**
4. **Accounting approvals** (before posting or import):
   1. a written EAS 48 decision;
   2. a separate written VAT-base decision;
   3. an approved historical commission-rate methodology.
5. **Owner approval to deploy.**

## Next steps
2. The DBA runs checks 0–6 and the restored-copy rehearsal (`docs/finance/rehearsal/README.md`).
3. Design and set up the restricted posting role and identity mechanism (H3).
4. The accountant answers the D-01 pack.
