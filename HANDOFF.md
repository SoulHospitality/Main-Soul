# HANDOFF: Financial reconstruction

**Updated:** 2026-11-25 · **Branch:** `feature/finance-ledger`, all work committed and pushed (the latest commit is this HANDOFF's). `main` is untouched (`ff782cd`).
**Decision: NO-GO.** Development work is complete. What remains are external approvals and actions (below). Not merged, not deployed, posting **off**, no historical import, reports not switched to the stored ledger, production untouched.

## Start here
| Reader | Document |
|---|---|
| Owner | `docs/finance/DEPLOYMENT_READINESS.md` (gates §10, deployment sequence §9) |
| Accountant | `docs/finance/ACCOUNTANT_REVIEW_PACKAGE.md` (three decisions, questions R-1 to R-8) |
| DBA | `docs/finance/DBA_REVIEW_PACKAGE.md` (live checks, backup and restore, rehearsal, roles and identity, deployment) |
| Developer | `docs/finance/TESTING_AND_VALIDATION.md`, `POSTING_CONTROLS_AUDIT.md`, `FINANCIAL_INTEGRATION_MATRIX.md`, `ACCOUNTING_ENGINE_VALIDATION.md`, `FINANCIAL_REPORT_VALIDATION.md` |

## Commits on the branch
| Commit | Content |
|---|---|
| `6955687` | Foundation: documents, money layer, migrations 175/176, decimal.js |
| `b9d56fe` | Migration 175 hardening, D-01 pack |
| `9e74bb4` | Readiness controls, rehearsal kit, live check 0 |
| `f743ac8` | HANDOFF and readiness hash |
| `3caa574` | Report fixes: P&L with closed months, balance sheet after a close, unbalanced month close |
| `97eec90` | Ledger controls from the pre-commit review (H1, H2, M1–M3, M6, M7, L1–L10) |
| `bcefd43` | Verified identity (H3), restricted role `soul_app`, API lockdown |
| `38a2e54` | Integration coverage (8 more scenarios) and engine error handling (query errors surface, closed-month check fails closed, unknown accounts reported) |
| `0fffa90` | Paymob webhook automated tests |
| (latest) | Backup and restore validation, accountant and DBA packages, final readiness |

## What the branch delivers (all inactive until deployed and approved)
- **Stored, immutable double-entry ledger** (migration 176). The database enforces:
  - balance, immutability (including against TRUNCATE), and lines only while posting;
  - the policy in force, with two separate written approvals (EAS 48 and VAT);
  - closed periods, and reversal and replacement rules;
  - verified, transaction-bound identity, with approvals recorded by the approver;
  - the posting switch (off).
- **Commission snapshots at confirmation** (migration 175), corrected only through a verified, logged process.
- **Engine report fixes:** DEF-PL-01, DEF-BS-01, DEF-CLOSE-01, L4, L5, DEF-SRC-01, DEF-PER-01, DEF-ACC-01. These change displayed reports once deployed.
- **Restricted application role** and the identity-key procedure (`docs/finance/db-security/`). The migration runner can use `MIGRATION_DATABASE_URL`.
- **Rehearsal kit:** read-only live checks 0–6, a backup/restore inventory, r1–r5, rollbacks, and the engine-fix comparison tool.

## Test results (synthetic data; local)
| Suite | Result |
|---|---|
| `npm test` | 155 tests, **154 pass**. The 1 failure is `hrRules.test.js:362` (commit `ad8515f` changed the attendance rule; HR to decide) |
| PGlite: ledger / engine / engine-extra / security / Paymob / rehearsal / live checks | 139/139 · 43/43 · 23/23 · 20/20 · 11/11 · 26/26 (r3 45/45) · pass |
| **Real PostgreSQL 17.5 as `soul_app`** (genuine multi-session) | 13/13 |

Nothing has been run on production, Supabase or a restored copy.

## External approvals and actions that remain
1. **DBA:** live checks 0–6 on production (read-only).
2. **DBA:** backup and restore validation into a separate project, with the inventory identical.
3. **DBA and developer:** the restored-copy rehearsal, including the old-vs-new-code engine comparison, the `soul_app` and identity setup, concurrency and rollbacks.
4. **Accountant** (before posting or import):
   1. the EAS 48 decision;
   2. a separate VAT-base decision;
   3. the commission-history method.

   Also answers to R-1 to R-8.
5. **Owner:** written GO to deploy, and separate authorisation to merge into `main`.
6. **At deployment:** the DBA runs the role and key setup on production and switches `DATABASE_URL` to `soul_app` (H3 is only effective after this).

## Found outside finance (not changed on this branch)
- **HR:** the `hrRules.test.js:362` rule-versus-test mismatch (above).
- **Website bookings:** `services/pmsNotifications.js:114` writes a booking UUID into the integer column `notifications.entity_id`, so the staff notification for each new paid website booking fails silently.
- **Security:** `docs/security/NPM_AUDIT_REMEDIATION.md` (untracked) is the dependency and email-escaping plan, to run as its own approved work.
