# Deployment Readiness: Finance Ledger Foundation (Migrations 175 and 176)

**Date:** 2026-11-24 · **Branch:** `feature/finance-ledger` · **Decision: NO-GO.** Production deployment is blocked; see §10.
This document replaces `DEPLOYMENT_READINESS_CHECKLIST.md`. Approval to commit or push is not approval to deploy. Nothing is deployed without the owner's explicit written approval.

## 1. Branch and production state

| Item | Evidence | Status |
|---|---|---|
| Commits on the remote | `origin/feature/finance-ledger` = `9e74bb4` (readiness) → `b9d56fe` → `6955687` → `ff782cd` (the `main` base); local HEAD equals the remote | ✅ Verified 2026-11-24 |
| No unrelated changes | `git diff --name-only origin/main...origin/feature/finance-ledger`: 31 files, all under `docs/finance/`, `Server/src/lib/accounting/`, migrations 175/176, `HANDOFF.md`, and `Server/package.json`/`package-lock.json` (decimal.js only) | ✅ |
| Pushed commits untouched | No amend, rebase or force-push | ✅ |
| `main` unchanged | `origin/main` = `ff782cd`; 175 and 176 are not in `main`'s migrations folder; no merge | ✅ |
| Working tree | All finance work is committed (`9e74bb4`). The only untracked item is `docs/security/`, which is kept out of the finance branch on purpose. | ✅ |
| Production runs the existing implementation | **Indirect evidence only:** production deploys from `main`, which has neither migration. `/api/health` does not report a version. **Direct proof needs live check 0** (`live-checks/00_deployment_state.sql`), which must show last migration `174_…` and no ledger objects. | ☐ Waiting for check 0 |

## 2. Production database checks (read-only)
These are run by an authorised DBA under the SELECT-only `finance_checks` role (see `live-checks/README.md`). **None has been run.** No result is assumed.

| # | Check | What would block deployment | Result | Analysis |
|---|---|---|---|---|
| 0 | Deployment state | Anything other than "174, nothing applied" | ☐ not run | — |
| 1 | Amount quality | Null or zero totals on confirmed stays; negative non-refund payments | ☐ not run | — |
| 2 | USD rates | Any USD stay without a rate (blocks import, not deployment) | ☐ not run | — |
| 3 | Duplicate payment refs | Duplicate groups, or the unique index missing (blocks import) | ☐ not run | — |
| 4 | cash_ledger vs cash | Informational (retire as read-only history) | ☐ not run | — |
| 5 | Commission rate changes | Sizes the historical review list (§7) | ☐ not run | — |
| 6 | Frozen months balance | Any non-zero difference (blocks import) | ☐ not run | — |

Run by: ________ · Date: ________ · Analysed by: ________

## 3. Changes made during this readiness phase (committed in `9e74bb4`)
Rehearsal design turned up three control gaps. All are fixed in the not-yet-deployed migrations, and all are tested.

1. **The posting switch was enforced only in application code.** A direct database insert could write ledger entries while posting was "off". The database now refuses any entry unless `ledger_posting = 'on'` **and** the entry names an **approved** policy in force on its date.
2. **Lines could be added to an already-posted entry later.** This could quietly change its amounts, or unbalance it with no check firing. The database now allows lines only in the transaction that created their entry.
3. **D-01 and VAT approvals were a single approval,** and approved policies could be edited. A policy can now be approved only with **two separate written approvals**: presentation (`approved_by`/`approved_at`/`approval_ref`) and VAT base (`vat_approved_by`/`vat_approved_at`/`vat_approval_ref`), each with its setting. Once approved, a policy can only be retired, never edited or deleted.

**Also:**
- Commission corrections are now authorised **in the database** (active admin; an approver who is a different active admin), not only in application code.
- The "snapshots began" timestamp now keeps microseconds.
- `posting.js` refuses with `NO_POLICY` when no approved policy is in force.

## 4. Migration rehearsal

### 4a. Local rehearsal (done)
In-process Postgres (PGlite), real migration chain 000–174, seeded data, and the repository's own rehearsal scripts. Evidence: `rehearsal/evidence/local-rehearsal-2026-11-24.json`. Runner: `rehearsal/local/rehearsal.js`.

| Area | Result |
|---|---|
| Recovery from partial failure: 175 failing part-way, 176 failing at its last statement | ✅ Nothing left behind, not recorded as applied, earlier migration unaffected, clean re-apply afterwards |
| Applying 175 and 176 with the app's runner semantics, then a second start | ✅ Applied once, then skipped. Re-running both files by hand is harmless (idempotent). |
| Structure (r2) | ✅ 14 of 14 |
| Existing data unchanged (r1 fingerprints of reservations, payments, expenses, cash_ledger, frozen months, custom accounts, rates, settings) | ✅ Identical before and after |
| Books shown by the existing engine (trial balance plus every journal line hashed) | ✅ Identical before and after |
| Existing app behaviour on the migrated DB: edits, status changes, a confirmed insert; the engine still builds balanced books | ✅ |
| Historical stays: no snapshot, all on the review list; a pre-deployment pending stay confirmed later is flagged | ✅ |
| Behaviour (r3): snapshot capture with applied rates, retries and duplicates, rate changes, hand-written snapshots blocked, review flags, correction authorisation and immutable log, posting controls (switch, two approvals, draft refused, balance, immutability, no late lines, idempotency, single reversal) | ✅ 34 of 34 |
| r3 refuses to run without the restored-copy declaration | ✅ |
| Rollback **with** test entries: refuses without confirmation, removes everything with it; soft rollback of 175 keeps snapshots and reservations keep saving; full rollback of 175 refuses without confirmation, then removes everything | ✅ |
| Rollback **without** entries (normal pre-cutover case): no confirmation needed; existing data identical afterwards; 175 and 176 re-apply cleanly | ✅ |
| **Total** | **26 of 26 steps passed** |

**Not covered locally:** real production data volume and shape, the Supabase environment (roles, extensions, row-level security), real start-up timing, and the UI and integration paths (website checkout, chatbot booking, channel import, Paymob webhooks).

### 4b. Restored-copy rehearsal (not done; required)
Follow `rehearsal/README.md` §0–9.

| Step | Pass condition | Result |
|---|---|---|
| Baseline r1 and books | Recorded | ☐ |
| r5 partial failure | All three counts 0 | ☐ |
| App start applies 175 and 176; restart skips | Log lines; time recorded | ☐ ___ s |
| r2 structure | All passed | ☐ |
| r1 and books diff | Only the migrations line differs; books identical | ☐ |
| Manual compatibility smoke test (§5) | Every item works | ☐ |
| r3 behaviour | 34 of 34, 0 failed | ☐ |
| Rollback with entries; app from `main` works | As written | ☐ |
| Rollback without entries; fingerprint matches | As written | ☐ |

Run by: ________ · Copy restored from (backup id or PITR time): ________ · Date: ________

## 5. Rollback evidence and plan
- **Evidence:** local rehearsal, §4a rows "Rollback with/without entries". Restored-copy evidence is pending (§4b).
- **Scripts:** `rehearsal/rollback_175_soft.sql` (preferred; loses nothing), `rollback_175_full.sql` and `rollback_176.sql`. The last two need explicit confirmation when data would be lost.
- **Order in production:** redeploy the previous build (`main`) **first**, then run the rollback SQL. Otherwise the app re-applies the migrations on its next start.
- **Backup:** Supabase PITR or a daily backup must be confirmed enabled, a test restore done (the restored-copy rehearsal counts as one), and a fresh backup taken immediately before deployment. ☐ PITR/backup confirmed · ☐ test restore done · ☐ pre-deployment backup id: ________

## 6. Accounting approvals (block posting and import, not the deployment of 175/176)
| Approval | Required form | Status |
|---|---|---|
| Decision 1: revenue presentation (EAS 48), per contract type | Signed table, D01 pack §7 | ☐ Not received |
| Decision 2: VAT base, per contract type, **separately** | Signed table, D01 pack §7 | ☐ Not received |
| Both entered as one approved `ledger_policies` version with both approval references | The database refuses approval without both | ☐ |
| Historical commission methodology (§7) | Owner and accountant approval | ☐ |

Until all four are done: no historical import, no posting (`ledger_posting` stays `off`), no report switch.

## 7. Historical commission methodology (proposed, awaiting approval)
For confirmed stays with no snapshot (the review list). **Today's rate is never bulk-applied.**

1. **Sources, in order of authority:**
   1. the signed owner contract or addendum in force on the stay's confirmation date;
   2. the owner statement actually sent for that month, if archived;
   3. the `audit_log` `UPDATE_UNIT` history (check 5): the rate *before* any later change;
   4. for a salesperson %, payroll and commission payout records, since salesperson rate changes are not field-audited.
2. **Where no source exists,** the stay stays `needs_review`, and owner and accountant decide case by case. The decision and its reason are recorded.
3. **Applying it:** each established rate is entered as a **logged correction** (active admin, a different admin approving, a reason naming the source document). A batch tool for this would be a separate, approved change; it must produce one correction row per stay, never a bulk update.
4. **Completeness:** before any historical import, the review list is empty, or every remaining stay is explicitly accepted as "rate unknown, excluded from import".

## 8. Security blockers
Full plan: `docs/security/NPM_AUDIT_REMEDIATION.md`. These are uncommitted and kept separate from the finance branch.

| Item | Affects this deployment? | Recommendation |
|---|---|---|
| Critical proxy-addr | Not reachable with `trust proxy = 1` | Patch (P1) before or alongside; **not a blocker** for 175/176 |
| Denial of service in body-parser, qs and Socket.IO | Pre-existing; unrelated to 175/176 | P1–P2 soon; not a blocker |
| Unescaped input in staff emails (inquiry, Become a Host) | Pre-existing | P3 soon; not a blocker |
| xlsx (attendance import) | Pre-existing | P4; not a blocker |

None of these is introduced or made worse by migrations 175 or 176. They are tracked as separate work, and **none blocks this deployment**, but P1–P3 are recommended before the next production release of any kind.

## 9. Exact deployment sequence (after GO only)
1. **Pre-checks (same day):**
   - live check 0 shows `174`;
   - checks 1–6 reviewed;
   - restored-copy rehearsal §4b all ✅;
   - the owner's written GO.
2. **Freeze:** announce a 15-minute window outside check-in and check-out peaks, and pause manual finance edits.
3. **Backup:** take a Supabase backup, or note the PITR timestamp; record its id in §5.
4. **Merge:**
   - open a PR `feature/finance-ledger` → `main`;
   - review the migration diff only;
   - the repository has no CI workflow, so run `npm test` locally on the merge result and attach the output to the PR;
   - merge, without a squash that hides the migration history.
5. **Deploy:**
   - Render deploys `main`, and on start-up the app applies 175 and then 176, each in one transaction;
   - watch the logs for both `Applied migration` lines;
   - on any `[db] Migration … failed`, go to step 8.
6. **Verify (as the read-only role):**
   - `00_deployment_state.sql` shows `176`;
   - `rehearsal/r2_verify_structure.sql`: all passed;
   - `r1_fingerprint.sql`: identical to the pre-deployment run, apart from the migrations line.
7. **Smoke test in production:**
   - log in;
   - open the Today board;
   - edit a reservation's notes;
   - confirm one real pending reservation and check its snapshot is `captured`;
   - open the Financial System trial balance, which must equal the pre-deployment figures.

   Posting stays **off**.
8. **If anything fails:** roll back as in §5 (soft rollback of 175 first; redeploy `main` before running full rollback SQL), then report.
9. **Record:** time, who, the backup id and the verification outputs, kept privately; then update this document and `HANDOFF.md`.

## 10. Go/no-go
**NO-GO.** This holds until the owner gives explicit written approval to deploy. Committing and pushing (approved 2026-11-24) is **not** approval to merge, deploy, enable posting, import historical data, switch reports, or change production.

**Evidence levels used in this report:**
- **Verified:** observed on the real system or the real repository.
- **Local-only:** passed on the in-process PGlite rehearsal with seeded data, not on production data.
- **Assumption:** inferred, not yet observed.

So far: the branch and `main` state are *verified*; the rehearsal results in §4a are *local-only*; "production runs the existing implementation" is an *assumption* until check 0 is returned.

| Gate | State |
|---|---|
| Branch verified, `main` untouched | ✅ Verified |
| Readiness fixes (§3) committed and pushed | ✅ `9e74bb4` |
| Live checks 0–6 run and reviewed | ☐ |
| Restored-copy rehearsal passed | ☐ |
| Backup and restore confirmed; pre-deployment backup taken | ☐ |
| Owner's explicit approval to deploy | ☐ |
| (Posting and import only) 1. Written EAS 48 principal-versus-agent decision | ☐ not needed for deploying 175/176 |
| (Posting and import only) 2. Separate written VAT-base decision | ☐ not needed for deploying 175/176 |
| (Posting and import only) 3. Approved historical commission-rate reconstruction methodology | ☐ not needed for deploying 175/176 |

No historical import and no ledger posting before all three accounting gates are approved.

The decision becomes GO only when every deployment gate above is ✅ and the owner approves in writing.
