# Merge and Deployment Package

**Prepared:** 2026-11-25. **Nothing has been merged, no pull request has been opened, nothing has been deployed.** Each merge and each deployment needs the owner's separate written authorisation; the finance deployment also needs the gates in `DEPLOYMENT_READINESS.md` §10.

## The three branches
| Branch | Head | What | Gates before production |
|---|---|---|---|
| `fix/website-booking-notification` | `21bbfc8` | Staff were never notified of new paid website bookings (a UUID written into an integer column; the error was swallowed) | Owner's approval only |
| `security/remediation-2026-11` | `c922268` | Server audit 12 → 3 moderate (accepted); client audit 16 → 0; HTML escaping in staff emails | Owner's approval; deployer checks in `docs/security/NPM_AUDIT_REMEDIATION.md` |
| `feature/finance-ledger` | see `HANDOFF.md` | Stored ledger (inactive), commission snapshots, report fixes, restricted role | All of `DEPLOYMENT_READINESS.md` §10. Posting and import also need the three accounting approvals |

The first two are independent of finance and can ship first.

## Trial merge (done locally, not pushed)
Order: fix → security → finance, onto `origin/main` (`ff782cd`), in a throwaway worktree.

| Step | Result |
|---|---|
| fix | Clean |
| security | One conflict: the `test` line in `Server/package.json` (both appended a test file). **Resolution:** keep both lists |
| finance | Conflicts in `Server/package.json` (`test` line; dependency list) and `Server/package-lock.json`. **Resolution:** union of the test lists; keep `decimal.js 10.6.0`; do **not** re-add `csv-parse` (security removed it). Take the security side of the lockfile, then `npm install --package-lock-only` to regenerate it |

**Merged result, verified:**
- `npm ci` installs from the regenerated lockfile.
- `npm test`: **171 tests, 170 pass**. The one failure is the pre-existing `hrRules.test.js:362` (HR to decide).
- Database suites against the merged `Server` all pass: ledger, engine 43 and 23, security 20, Paymob 11, rehearsal 26.
- The Paymob webhook suite logs **0** notification failures (2 on the finance branch alone), confirming the fix end to end.
- `npm audit --omit=dev`: 3 moderate, all the accepted `uuid` advisory.

Do the real merges in the same order and resolve the conflicts the same way. Run `npm test` on each merge result: there is no CI.

## Pull request texts (to open only when the owner authorises it)
Opening a PR may trigger preview deployments on the hosting platform; check that first.

### 1. Fix silent failure of website-booking staff notifications
> `notifications.entity_id` is an integer column; the new/accepted/rejected website-booking notifications passed the booking UUID, so every insert failed and the error was swallowed. `notifyStaff` now keeps integer ids and stores null otherwise (the client routes these notifications by type, not id). Adds `pmsNotifications.test.js` (4). Verified against Postgres column semantics and through the Paymob webhook flow.
>
> **Test plan:** `npm test`; after deploy, make one website booking and confirm the web team gets the notification.

### 2. Security remediation (dependencies and email escaping)
> Express 4.22.3, Socket.IO 4.8.4, nodemailer 10.6.1, SheetJS 0.20.3 (vendor CDN), csv-parse removed; client jspdf 4.2.1 and in-range fixes; guest input escaped in staff emails. Full verification and deployer checks in `docs/security/NPM_AUDIT_REMEDIATION.md`.
>
> **Test plan:** deployer checks 1–4 in that document (timezone, email path, click-through, rollback per commit).

### 3. Financial reconstruction (inactive ledger, snapshots, report fixes)
> See `HANDOFF.md` and `docs/finance/DEPLOYMENT_READINESS.md`. Posting stays off; no historical import. Report figures change where months are closed (`FINANCIAL_REPORT_VALIDATION.md`); the restored-copy comparison must be reviewed first.
>
> **Test plan:** `DEPLOYMENT_READINESS.md` §9 steps 1–10.

## Deployment order
1. **Fix**, then **security**: each one a merge, deploy and click-through, with rollback by reverting its merge commit. Security needs one build-environment check: Render's `npm ci` must reach `cdn.sheetjs.com`.
2. **Finance**, only after every §10 gate:
   - live checks;
   - backup and restore;
   - the restored-copy rehearsal;
   - the owner's GO.

   Follow §9: backup, merge, deploy with `MIGRATION_DATABASE_URL`, verify, role and key setup, smoke test. Posting stays **off**.
3. **Posting and historical import:** only after the three accounting approvals (`ACCOUNTANT_DECISION_TRACKER.md`) and the owner's separate instruction.

## What is ready and what is not
| Item | State |
|---|---|
| All code and tests for the three branches | ✅ Pushed; trial merge verified |
| Local rehearsal of the whole runbook on real PostgreSQL 17.5, including the old-vs-new comparison and the app's own migration runner | ✅ (`rehearsal/evidence/real-postgres-*-2026-11-25.json`) |
| Live checks on production | ☐ DBA (no production access in development) |
| Backup and restore into a separate project | ☐ DBA |
| Rehearsal on the restored copy | ☐ DBA and developer |
| Accountant's three decisions | ☐ Not received |
| Owner's authorisations to merge and to deploy | ☐ |
