# HANDOFF: Financial reconstruction

**Updated:** 2026-11-25 · **Branch:** `feature/finance-ledger`. **Deployed:** GitHub `main` `81ae640` is live on Railway and Vercel (deployment record below).
**Status: DEPLOYED, posting OFF.** The fixes, security and finance are live. Migrations 175–179 are applied and the accountant's settings are in place. What remains is the in-app go-live by the CEOs and financial managers, then the opening balances from the owner.

## Start here
| Reader | Document |
|---|---|
| Owner | `docs/finance/PRE_MERGE_VERIFICATION.md` (final pre-merge report), `docs/finance/MERGE_AND_DEPLOYMENT_PACKAGE.md` (three branches, merge order, PR texts), then `docs/finance/DEPLOYMENT_READINESS.md` (gates §10, sequence §9) |
| Accountant | `docs/finance/ACCOUNTANT_REVIEW_PACKAGE.md`; status in `docs/finance/ACCOUNTANT_DECISION_TRACKER.md` |
| DBA | `docs/finance/DBA_REVIEW_PACKAGE.md` |
| Developer | `docs/finance/TESTING_AND_VALIDATION.md`, `POSTING_CONTROLS_AUDIT.md`, `FINANCIAL_INTEGRATION_MATRIX.md`, `ACCOUNTING_ENGINE_VALIDATION.md`, `FINANCIAL_REPORT_VALIDATION.md` |

## Branches (all pushed; none merged)
| Branch | Head | Content |
|---|---|---|
| `feature/finance-ledger` | (this commit) | The financial reconstruction (below) |
| `fix/website-booking-notification` | `21bbfc8` | Staff are now notified of new paid website bookings. A booking UUID was being written into the integer `notifications.entity_id`, so every insert failed silently. Test added |
| `security/remediation-2026-11` | `99a89fb` | Server `npm audit` 12 → 3 moderate (one accepted `uuid` advisory); client 16 → 0; guest input escaped in staff emails. Record and verification: `docs/security/NPM_AUDIT_REMEDIATION.md` and `PRE_MERGE_VERIFICATION.md` on that branch |

**Trial merge** of all three onto `main`, reproduced from scratch on 2026-11-25: conflicts only in `Server/package.json` and its lockfile. Resolve them with `docs/finance/merge/resolve-package-json.js`: a whole-file "ours" silently reverts the security upgrades. Result: 171 tests, 170 pass (the HR failure below); every database suite passes; the merged tree builds and boots as on Railway. Details: `PRE_MERGE_VERIFICATION.md`, `MERGE_AND_DEPLOYMENT_PACKAGE.md`.

## Commits on this branch
| Commit | Content |
|---|---|
| `6955687` | Foundation: documents, money layer, migrations 175/176, decimal.js |
| `b9d56fe` | Migration 175 hardening, D-01 pack |
| `9e74bb4` | Readiness controls, rehearsal kit, live check 0 |
| `f743ac8` | HANDOFF and readiness hash |
| `3caa574` | Report fixes: P&L with closed months, balance sheet after a close, unbalanced month close |
| `97eec90` | Ledger controls from the pre-commit review (H1, H2, M1–M3, M6, M7, L1–L10) |
| `bcefd43` | Verified identity (H3), restricted role `soul_app`, API lockdown |
| `38a2e54` | Integration coverage and engine error handling |
| `0fffa90` | Paymob webhook automated tests |
| `609e6f9` | Backup and restore validation, accountant and DBA packages, final readiness |
| `10f5b53` | Real-PostgreSQL rehearsal and runbook, accountant tracker, merge and deployment package |
| `1e6d92d` | Pre-merge verification of all three branches; three-way merge helper; hosting corrected to Railway/Vercel |
| `30cec75` | Financial System screens for the ledger: Ledger controls, Commission review, integrity warning (read-only; English and Arabic) |
| `eeb1a88` | Phase 4/5 tooling: historical migration, reconciliation, parallel-run sync |
| `88ef5c0` | Phase 6: migration 177 (guarded report source), reports from the stored ledger, rollback_177, rehearsal covering 177 |
| `c7a7d0b` | Phase 7: migration 178 (permanent reconciliation history), nightly job, Data health exception, Close-month step, reconciliation dashboard |
| `3e1cbfb` | Phase 3: production read-only checks 0–6, baselines, engine comparison |
| `7c6055d` | Accountant's decisions: VAT suspension, refunds reverse revenue (R-1), owner share of forfeits (R-5), books from 25/11, policy 2026.11 and its tools, full go-live rehearsal |
| (latest) | Withholding suspended; go-live and ledger operation inside the app for CEOs and financial managers (migration 179); nightly auto-posting; "Sync changes" |

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
- **Rehearsal kit:** read-only live checks 0–6, a backup/restore inventory, r1–r5, rollbacks, the engine-fix comparison tool, and local runners for PGlite and real PostgreSQL.

## Accountant's decisions (received 2026-11-25, relayed by the owner)
Gross revenue; **VAT 0 from 25/11** (taxes postponed); no historical commissions; **books start 25/11** (no import); refunds reverse revenue and tax; the owner gets forfeit − company %. Part D was decided by the owner. Details: `docs/finance/ACCOUNTANT_DECISION_TRACKER.md`. Go-live steps: **`docs/finance/FINANCE_GO_LIVE.md`** (rehearsed end to end on real PostgreSQL, 20/20). Still open: withholding tax, and the signed copy reference.

## Phase status (honest)
| Phase | Built and tested | Executed for real |
|---|---|---|
| 1 Audit and architecture | ✅ | ✅ |
| 2 Ledger foundation | ✅ | ✅ Deployed 2026-11-25 (175, 176) |
| 3 Deployment and external validation | ✅ | ✅ Checks 0–6, accountant's decisions, deployment and settings (backup/restore test waived by the owner) |
| 4 Historical migration | ✅ | ✅ **Not needed: the books start 25/11** (accountant). Only the 25/11-onward sync remains, which is part of go-live |
| 5 Parallel operation | ✅ `sync` + `reconcile` (same runbook) | ☐ Needs Phase 4 and a real month |
| 6 Activation and reporting | ✅ Migration 177, reports from the ledger, tested rollback (`LEDGER_ACTIVATION_RUNBOOK.md`) | ◐ Deployed. ☐ Go-live in the app (approve, record, posting on, sync); reports switch after a clean December |
| 7 Operations and optimisation | ✅ Nightly reconciliation (migration 178), Data health exception, month-end step, reconciliation dashboard (`FINANCIAL_OPERATIONS.md`) | ☐ Starts by itself once posting is on |

## Financial System screens (this branch)
**Books → Ledger controls** and **Books → Commission review**, plus an integrity warning on Financial statements. They are read-only and bilingual, and they say plainly when 175/176 are not installed yet. Details, tests and screenshots: `docs/finance/FINANCIAL_SYSTEM_UI.md`.

## Deployment record (2026-11-25)
| Step | Result |
|---|---|
| 1. Release (fixes + security) | `main` `71118c5` (fast-forward from `ff782cd`). Railway `a53e906d` SUCCESS, Vercel `dpl_8tc5WNix…` READY. Smoke checks passed |
| 2. Finance merge | `main` `81ae640` (`--no-ff` from this branch; package files resolved with `resolve-package-json.js`). `npm test` 170/171 (HR only), audit: only `uuid`. Every finance file identical to the branch |
| 3. Railway variables | `LEDGER_IDENTITY_KEY_ID=k2026a` and a newly generated `LEDGER_IDENTITY_KEY` (set without redeploy; never printed). `FINANCE_BOOKS_START` is not needed: the server reads the books start from the database |
| 4. Deploy | Railway `bb6a9b75` SUCCESS: "Applied migration 175 … 179" in the start-up log. Vercel `dpl_6ZF3tzke…` READY |
| 5. Database | Identity key row `k2026a` inserted (matches the service variable). `2026-11-25_accountant_settings.sql`: books_reset_at 2026-11-12T12:17:42Z → 2026-11-24T22:00:00Z; VAT and withholding suspended from 2026-11-25; commissions settled |
| 6. Checks | Live check 0: last migration 179, five applied, 10 ledger tables, both switches present. r2: **19/19**. Health, socket and admin page 200; bad staff login 401; finance API 401 without login |
| Approvers | 4 admin (CEO) accounts and 1 financial manager are authorised by 179 |

Automatic deployment from `main` is **on** for both Railway and Vercel (every push to `main` deploys).

## Test results (synthetic data; local)
| Suite | Result |
|---|---|
| `npm test` | 155 tests, **154 pass**. The 1 failure is `hrRules.test.js:362` (commit `ad8515f` changed the attendance rule; HR to decide) |
| Ledger screens API (`ledger-ui-api-test.js`) and end-to-end in Chrome (`ui-e2e.js`, English and Arabic) | 21/21 · all pages render, no errors |
| PGlite: ledger / engine / engine-extra / security / Paymob / live checks | 139/139 · 43/43 · 23/23 · 20/20 · 11/11 · pass |
| Rehearsal (r0–r3, rollbacks, re-apply) | **31/31 on PGlite and 31/31 on real PostgreSQL 17.5** |
| Real PostgreSQL 17.5 as `soul_app` (genuine multi-session) | 13/13 |
| Real PostgreSQL 17.5, runbook §1–§3: old vs new code through `compare-books.js`, the app's own migration runner | 9/9. The old code's DEF-CLOSE-01 defect is visible (November close drops 620000 and is unbalanced by 700); the new code balances |

Nothing has been run on production, Supabase or a restored copy.

## What remains
1. **CEOs and financial managers, in the app** (Financial System → Ledger controls → Go-live; `FINANCE_GO_LIVE.md` §2): approve revenue (gross), approve taxes (suspended), record the policy (a *different* person), switch posting on with a reason, then **Sync changes**.
2. **Owner:** the bank and cash balances at 25/11, posted as one opening entry.
3. **Rotate the production database password** (it was shared in chat). Afterwards update `DATABASE_URL` on Railway.
4. **After a clean December:** switch reports to the ledger.
5. Optional hardening: `db-security/ledger_roles.sql`, then `DATABASE_URL` → `soul_app`.
6. HR to decide `hrRules.test.js:362`.

## Found outside finance
- **HR:** the `hrRules.test.js:362` rule-versus-test mismatch. Not changed; HR to decide.
- The website-booking notification and security items are fixed on their own branches (above).
- The untracked `docs/security/` folder in this working copy is the earlier plan. The final record is committed on the security branch. **Move it away before merging the security branch here**, or git will refuse.
- **Attendance times (HR):** `hrRules.excelTimeToHhMm` truncates, so a time stored a fraction of a millisecond before a whole minute reads one minute early (same before and after the security branch). Rounding to the nearest second would fix it. HR to decide.
