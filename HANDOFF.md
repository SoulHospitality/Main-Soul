# HANDOFF: Financial reconstruction

**Updated:** 2026-11-24 · **Branch:** `feature/finance-ledger`, pushed; **not merged** into `main`; **not deployed**; posting **off**.
**Decision: NO-GO for production.** See `docs/finance/DEPLOYMENT_READINESS.md` §10. Nothing is deployed without the owner's explicit approval.

## Commits on the branch (accepted)
| Commit | Content |
|---|---|
| `6955687` | Phase 1 and 2 foundation: documents, accounting library, migrations 175/176, decimal.js 10.6.0, HANDOFF |
| `b9d56fe` | Migration 175 hardening, D-01 pack revision, first checklist, HANDOFF |

Verified 2026-11-24:
- the remote matches local;
- 31 changed files versus `main`, all finance;
- `main` is still `ff782cd`, without 175 or 176;
- no pushed commit was rewritten.

## Readiness phase (2026-11-24): uncommitted, awaiting approval to commit
**Modified:**
- `Server/supabase/migrations/176_ledger_core.sql`: database-level posting controls:
  - the switch is enforced in the database;
  - an approved policy is required;
  - D-01 and VAT approvals are separate;
  - approved policies are permanent;
  - no lines can be added to a posted entry later.
- `Server/supabase/migrations/175_commission_snapshots.sql`: correction authorisation enforced in the database; microsecond start time.
- `Server/src/lib/accounting/posting.js`: refuses with `NO_POLICY` when no approved policy is in force.
- `docs/finance/live-checks/README.md`: check 0, grants, exact run loop.
- `docs/finance/ACCOUNTING_DECISIONS_REGISTER.md`: D-11 is a separate approval; D-12 methodology.
- `docs/finance/DATA_MIGRATION_PLAN.md`, `docs/finance/TESTING_AND_VALIDATION.md`: counts and references.

**Deleted:** `docs/finance/DEPLOYMENT_READINESS_CHECKLIST.md`, superseded.

**New:**
- `docs/finance/DEPLOYMENT_READINESS.md`: the readiness report and go/no-go.
- `docs/finance/live-checks/00_deployment_state.sql`: proves directly what production runs.
- `docs/finance/rehearsal/`:
  - the runbook (`README.md`);
  - scripts `r1_fingerprint.sql`, `r2_verify_structure.sql`, `r3_behaviour.sql` and `r5_partial_failure.sql`;
  - rollback scripts for 175 (soft and full) and 176;
  - `compare-books.js`;
  - `local/`, the PGlite rehearsal tooling;
  - `evidence/local-rehearsal-2026-11-24.json`.

**Separate, not finance (keep off this branch):** `docs/security/NPM_AUDIT_REMEDIATION.md`, the prioritised remediation plan.

Migrations 175 and 176 have never been applied anywhere, so they were revised in place.

## Test and rehearsal results (2026-11-24)
- **Local rehearsal:** 26 of 26 steps passed. Behaviour checks (r3) 34 of 34; structure checks (r2) 14 of 14. Covered:
  - partial-failure recovery;
  - idempotent apply;
  - data and books unchanged;
  - app compatibility;
  - rollback with and without entries;
  - re-apply.
- **`ledger-test.js`:** 52 of 52. **`livechecks-test.js`:** all pass, including check 0 reading the pre-deployment state correctly.
- **`npm test`:** 108 of 109. The single failure is `hrRules.test.js:362`; that code is unchanged and the test also fails on `main`, so it needs a fix there.
- **Not yet done:**
  - the restored-copy rehearsal (needs a DBA and a copy);
  - the production live checks (needs a DBA).

## Remaining blockers to deployment
1. Approval to commit and push the readiness changes listed above.
2. Live checks 0–6 run on production and analysed. Check 0 is the direct proof that production still runs 174.
3. Restored-copy rehearsal, `rehearsal/README.md` §0–9, all passing.
4. Backup/PITR confirmed, a test restore done, and a pre-deployment backup taken.
5. The owner's explicit approval to deploy.

## Blockers to posting and historical import (later)
- D-01 (EAS 48 presentation) and D-11 (VAT base): **two separate signed approvals** per contract type.
- Historical commission methodology, proposed in `DEPLOYMENT_READINESS.md` §7, approved.
- Then: posting rules per event, a dry-run import with reconciliation, a one-month parallel run, cutover.

## Security (separate work)
Priority order: Express/proxy-addr → Socket.IO → HTML escaping in the inquiry and "Become a Host" emails → xlsx to exceljs → remove csv-parse → nodemailer.
- The critical finding is not reachable with `trust proxy = 1`.
- None of these blocks deploying 175/176, but P1–P3 are recommended before the next release.
- Each needs separate approval, on its own branch from `main`.

## Next steps
1. The owner approves committing the readiness changes.
2. A DBA runs live checks 0–6 and the restored-copy rehearsal; results go into `DEPLOYMENT_READINESS.md`.
3. Developer analysis of the results, then GO/NO-GO for the owner.
4. Send the D-01 pack to the accountant (two separate approvals).
