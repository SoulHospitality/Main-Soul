# HANDOFF: Financial reconstruction

**Updated:** 2026-11-25 · **Branch:** `feature/finance-ledger`, all work committed and pushed (the latest commit is this HANDOFF's). `main` is untouched (`ff782cd`).
**Decision: NO-GO.** Development work is complete on all three branches. What remains are external approvals and actions (below). Nothing is merged or deployed. Posting is **off**, there is no historical import, reports are not switched to the stored ledger, and production is untouched.

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
| (latest) | Financial System screens for the ledger: Ledger controls, Commission review, integrity warning (read-only; English and Arabic) |

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

## Financial System screens (this branch)
**Books → Ledger controls** and **Books → Commission review**, plus an integrity warning on Financial statements. They are read-only and bilingual, and they say plainly when 175/176 are not installed yet. Details, tests and screenshots: `docs/finance/FINANCIAL_SYSTEM_UI.md`.

## Release state (outside this branch)
- The fix and security branches are merged into **local** `main` (`8d31611`, `71118c5`) and published as `release/2026-11-25` (`71118c5`). It was pushed only as a Vercel Preview; Railway was not triggered.
- GitHub `main` and production remain `ff782cd`. Confirmed on 2026-11-25 from the deployment records and by matching the live site's files to a rebuild of `ff782cd`.
- The owner reports that automatic deployment from `main` is paused on Railway and Vercel. **This is not independently verified:** there is no dashboard access from development.
- Checklist: `Desktop/Main-Soul-preserved/CONTROLLED_DEPLOYMENT_CHECKLIST_2026-11-25.md`.

## Test results (synthetic data; local)
| Suite | Result |
|---|---|
| `npm test` | 155 tests, **154 pass**. The 1 failure is `hrRules.test.js:362` (commit `ad8515f` changed the attendance rule; HR to decide) |
| Ledger screens API (`ledger-ui-api-test.js`) and end-to-end in Chrome (`ui-e2e.js`, English and Arabic) | 21/21 · all pages render, no errors |
| PGlite: ledger / engine / engine-extra / security / Paymob / live checks | 139/139 · 43/43 · 23/23 · 20/20 · 11/11 · pass |
| Rehearsal (r0–r3, rollbacks, re-apply) | **28/28 on PGlite and 28/28 on real PostgreSQL 17.5** |
| Real PostgreSQL 17.5 as `soul_app` (genuine multi-session) | 13/13 |
| Real PostgreSQL 17.5, runbook §1–§3: old vs new code through `compare-books.js`, the app's own migration runner | 8/8. The old code's DEF-CLOSE-01 defect is visible (November close drops 620000 and is unbalanced by 700); the new code balances |

Nothing has been run on production, Supabase or a restored copy.

## External approvals and actions that remain (genuine blockers)
1. **DBA, production access needed:**
   - live checks 0–6 (read-only);
   - backup and restore into a separate project, with the inventory identical (`pg_dump` was not available locally, so this step is prepared but unrehearsed);
   - the restored-copy rehearsal, repeating the local runs above on real data.
2. **Accountant:** decisions 1–3 and R-1 to R-8. None received (`ACCOUNTANT_DECISION_TRACKER.md`).
3. **Owner:** written authorisation to merge each branch, and a separate GO to deploy each one.
4. **At finance deployment:** the DBA runs the role and key setup on production and switches `DATABASE_URL` to `soul_app` (H3 is only effective after this).
5. **Security deployment checks:**
   - record whether the Railway service sets `TZ` (unset/UTC: attendance import unchanged; Cairo: corrected readings);
   - whether `RESEND_API_KEY` or `SMTP_HOST` is set on Railway (the repository cannot show which);
   - the Railway build uses Node ≥ 20;
   - the Railway and Vercel builds fetch `xlsx` from `cdn.sheetjs.com` without `EINTEGRITY`.

   (The server deploys on Railway and the client on Vercel, per `railway.json` and `Client/vercel.json`; earlier notes said Render.)

## Found outside finance
- **HR:** the `hrRules.test.js:362` rule-versus-test mismatch. Not changed; HR to decide.
- The website-booking notification and security items are fixed on their own branches (above).
- The untracked `docs/security/` folder in this working copy is the earlier plan. The final record is committed on the security branch. **Move it away before merging the security branch here**, or git will refuse.
- **Attendance times (HR):** `hrRules.excelTimeToHhMm` truncates, so a time stored a fraction of a millisecond before a whole minute reads one minute early (same before and after the security branch). Rounding to the nearest second would fix it. HR to decide.
