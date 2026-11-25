# Pre-merge Verification: All Three Branches

**Date:** 2026-11-25. **Nothing merged, deployed or opened as a pull request; production not contacted.** All checks ran locally, on disposable copies and local databases with synthetic data.

## 1. Branch heads and remote status
| Branch | Local | Remote | Base | Commits ahead of `main` |
|---|---|---|---|---|
| `main` | `ff782cd` | `ff782cd` | — | — |
| `fix/website-booking-notification` | `21bbfc8` | `21bbfc8` | `ff782cd` (tip of `main`) | 1 |
| `security/remediation-2026-11` | `99a89fb` | `99a89fb` | `ff782cd` | 9 (the last adds verification documents only) |
| `feature/finance-ledger` | this commit | pushed with it | `ff782cd` | 12 |

`main` is unchanged locally and on GitHub. The remote holds only these four branches. The trial-merge commits exist only in a disposable working copy and were never pushed.

## 2. Diff summaries
| Branch | Files | Content | Unexpected files |
|---|---|---|---|
| fix | 3 | `pmsNotifications.js` (+16: one guard, one export), its new test (+88), the `test` script (+1 file) | None |
| security | 16 | Server and Client `package.json`/lockfiles; `escapeHtml.js`, `leadEmailHtml.js`, `attendanceWorkbook.js` and their tests; edits to `inquiries.js`, `hostRequests.js`, `reservationReceipt.js`, `hr.js`; `docs/security/` (2 documents) | None |
| finance | 85+ | Migrations 175/176; `src/lib/accounting/*`, engine and report fixes, `db.js` runner, Paymob tests; `docs/finance/*`; `HANDOFF.md` | None outside finance |

## 3. Website-booking notification fix
- **The change:** `notifyStaff` stores an id only when the integer column can hold it (a safe integer), and null otherwise. Every other notification entity has a serial integer id: reservations, leave/WFH/loan requests, owner comments, unit inspections, payout requests, KPI targets. Their behaviour is unchanged, and all three same-day dedupe callers pass integers.
- **The client:** routes `new_booking`, `booking_accepted` and `booking_rejected` by type, never by `entity_id`, so no link is lost.
- **Error handling:** callers still catch and log failures (`assignSalesOnCreate`), so a notification problem never blocks a booking.
- **Evidence, `main` against the branch:**

  | Check | `main` | Branch |
  |---|---|---|
  | Paymob webhook suite (11 checks pass on both) | 2 notification failures (`invalid input syntax for type integer`) | 0 |
  | `assignSalesOnCreate` on a fully migrated database | 0 rows written, error logged | 2 rows (both active web-team users; the inactive one skipped), no error |
  | `npm test` | — | 92 tests, 91 pass (the HR failure, §6) |
- **Nit, not a defect:** the guard accepts integers up to 2^53, while the column is 32-bit. All callers pass serial ids, so this cannot occur today.

## 4. Security branch
Full evidence is on that branch in `docs/security/PRE_MERGE_VERIFICATION.md`. Summary:
- **`xlsx` 0.20.3 from `cdn.sheetjs.com`:**
  - its sha512 matches both lockfiles;
  - no install scripts and no dependencies;
  - a tampered integrity hash fails with `EINTEGRITY`;
  - a crafted `__proto__` workbook **pollutes `Object.prototype` on `main`'s 0.18.5** and not on 0.20.3.
- **Reproducible builds:**
  - two empty-cache installs give identical trees;
  - **Railway's** build and start commands work on a clean export, with the lockfile not rewritten;
  - the Vercel-style client build succeeds.
- **Hosting (corrected):** the server runs on **Railway** (`railway.json`) and the client on **Vercel** (`Client/vercel.json`), not Render as earlier notes said.
- **Timezones:**
  - identical under UTC;
  - under Africa/Cairo, 0.20.3 reads stored times correctly (104/112) where 0.18.5 did not (56/112);
  - a pre-existing minute truncation in `hrRules.excelTimeToHhMm` behaves the same in both versions. It is reported for HR, not changed.
- **Email:** the code supports both. It uses Resend if `RESEND_API_KEY` is set, otherwise SMTP if `SMTP_HOST` is set, otherwise it only logs. **Which one production uses is not in the repository.**

## 5. Finance branch
- **Pushed head re-run from a clean export:** ledger 139, engine 43 and 23, security 20, Paymob 11, live checks, rehearsal 28 (PGlite) and 28 (real PostgreSQL 17.5), runbook 8, `soul_app` 13. All pass.
- **Production guard, tested empirically:** every validation ran with a preloaded network tripwire, children included, and with a canary production URL exported as both `DATABASE_URL` and `MIGRATION_DATABASE_URL`.
  - Result: 39 connections, **all to the local machine, 0 attempts elsewhere**.
  - Positive control: the same tripwire does catch a `db.js` query aimed at the canary.
  - Neither `Server/.env` nor a root `.env` currently holds a database URL. The guard holds even when one is exported, which takes precedence over `.env`.
- **Migration safety** (all in the 28-step rehearsal):
  - 175 failing part-way and 176 failing at the end leave nothing behind;
  - re-runs are skipped or harmless;
  - r2 16/16; existing data and books unchanged;
  - r3 45/45; every rollback works and re-applies.
- **Deployment package:** `MERGE_AND_DEPLOYMENT_PACKAGE.md`, corrected (next section and Railway/Vercel).
- **Still blocked, by design:**
  - production live checks;
  - backup and restore into a separate Supabase project;
  - the restored-copy rehearsal;
  - the three accounting decisions and R-1 to R-8 (none received; `ACCOUNTANT_DECISION_TRACKER.md`);
  - posting and historical import.

## 6. Combined integration (reproduced from scratch)
- **Merge order** fix → security → finance onto `origin/main`.
  - Conflicts were exactly the documented ones: `Server/package.json` at the security step; `Server/package.json` and `Server/package-lock.json` at the finance step.
- **Finding, now fixed in the package:**
  - rebuilding `package.json` from one whole side at the security step **silently reverted the security upgrades** (express 4.21, Socket.IO 4.8.1, nodemailer 6, xlsx 0.18.5);
  - the documented wording ("keep both lists") did not rule that out;
  - the package now requires a three-way resolution with `docs/finance/merge/resolve-package-json.js` (each branch keeps its own changes; removals stay removed; a real clash stops), plus a version check after each merge;
  - the helper reproduces the verified merge tree exactly.
- **Merged tree:**
  - the 2 + 12 + 83 files changed by the branches are byte-identical to their branches; nothing else changed;
  - the lockfile pins express 4.22.3, body-parser 1.20.9, qs 6.16.2, proxy-addr 2.0.8, socket.io 4.8.4, engine.io 6.6.13, socket.io-parser 4.2.7, nodemailer 10.6.1, xlsx 0.20.3 (verified integrity), decimal.js 10.6.0; `csv-parse` absent.
- **Tests on the merged tree:**
  - `npm ci` succeeds;
  - `npm test`: **171 tests, 170 pass**;
  - `npm audit --omit=dev`: 3 moderate, the accepted `uuid` advisory only;
  - every database suite above passes on the merged tree under the tripwire, with **0** Paymob notification failures.
- **Railway-style build and boot** of the merged tree against a fresh local PostgreSQL 17.5:
  - the app applied all **176** migrations at start-up;
  - posting switch `off`; health, inquiry (404), bad login (401) and Socket.IO respond; no errors.
- **Unresolved test failure (reported separately; HR's decision):**
  - `hrRules.test.js:362`, "fills absences by staff id and skips admin and operations";
  - commit `ad8515f` (2026-10-15) narrowed `NO_OFFICE_ATTENDANCE_ROLES` to admin and owner, so an `operations` user now gets an absence the test does not expect;
  - it fails identically on `main` and on every branch.
- **Main working copy:** it has an untracked `docs/security/` draft at the same paths the security branch adds. Remove or move it before merging there.

## 7. Supply-chain findings
| Finding | Severity | State |
|---|---|---|
| `main` runs SheetJS 0.18.5: prototype pollution reproduced with a crafted workbook (HR attendance upload) | High | Fixed on the security branch |
| Builds depend on `cdn.sheetjs.com` (not the npm registry) | Low | Integrity-pinned; an outage fails the build, not the service |
| `uuid <11.1.1` via exceljs and node-cron | Moderate | Accepted (needs a caller-supplied buffer with v3/v5/v6; only v4 used) |
| Two packages with install scripts (`@google/genai`, `protobufjs`) flagged by npm | Info | Pre-existing on `main`; unchanged by these branches |
| Email silently logged when neither Resend nor SMTP is configured | Low (pre-existing) | Deployer check |

## 8. Deployment prerequisites
| Branch | Before merging | Before or at deployment |
|---|---|---|
| fix | Owner's authorisation | Deploy; make one website booking and confirm the web team is notified |
| security | Owner's authorisation; move the untracked `docs/security/` draft | Railway build log: Node ≥ 20, `xlsx` fetched without `EINTEGRITY`; Vercel build; record whether `TZ`, `RESEND_API_KEY` and `SMTP_HOST` are set on Railway; click-through (`NPM_AUDIT_REMEDIATION.md`) |
| finance | Every `DEPLOYMENT_READINESS.md` §10 gate: live checks, backup and restore, restored-copy rehearsal, owner's GO | §9 sequence: backup, deploy with `MIGRATION_DATABASE_URL`, verify, `soul_app` role and identity key, smoke test. Posting stays **off** until the three accounting approvals and a separate instruction |

## 9. Recommended merge order
1. **`fix/website-booking-notification`:** smallest, independent, restores a broken staff workflow. Merges cleanly.
2. **`security/remediation-2026-11`:** fixes an exploitable flaw on `main` and needs no data or schema change. Resolve the one `package.json` conflict with the helper.
3. **`feature/finance-ledger`:** last, and only after its gates. Resolve `package.json` and the lockfile with the helper, then check the versions.

Run `npm test` after each merge (there is no CI) and deploy each separately, so each can be rolled back on its own.
