# HANDOFF: Financial reconstruction

**Updated:** 2026-11-24 · **Branch:** `feature/finance-ledger` at `9e74bb4`, then this HANDOFF update. Pushed; local equals remote.
**Decision: NO-GO.** Not merged into `main` (`main` is still `ff782cd`), not deployed, ledger posting **off**, no historical import, reports unchanged, production untouched.
Approval to commit or push is not approval to deploy. Nothing further happens without the owner's explicit approval.

## Commits on the branch
| Commit | Content |
|---|---|
| `6955687` | Phase 1 and 2 foundation: documents, accounting library, migrations 175/176, decimal.js 10.6.0 |
| `b9d56fe` | Migration 175 hardening, D-01 pack revision |
| `9e74bb4` | Readiness work, described below |
| (next) | This HANDOFF and the readiness report updated with the commit hash |

**`9e74bb4` contains:**
- database posting controls in migration 176;
- correction authorisation in the database (migration 175);
- `NO_POLICY` in `posting.js`;
- live check 0;
- the restored-copy rehearsal kit and the local rehearsal evidence;
- `DEPLOYMENT_READINESS.md`.

**Kept off the branch on purpose:** `docs/security/NPM_AUDIT_REMEDIATION.md`, which is still untracked. Security work is separate.

## What is verified, local-only, or assumed
| Claim | Level |
|---|---|
| Branch contents and `main` unchanged | **Verified** (git, 2026-11-24) |
| 175/176 apply, roll back, recover from failure, leave data and books unchanged; controls behave (26/26 steps, r3 34/34, r2 14/14) | **Local-only** (PGlite, seeded data) |
| Production still runs migration 174 | **Assumption** until live check 0 is returned |
| Production data quality (checks 1–6) | **Unknown**, not run |
| Behaviour on real data, Supabase environment, start-up timing, UI and integrations | **Unknown**, restored-copy rehearsal not run |

## Tests (local)
- `npm test`: 108 of 109. The single failure is `hrRules.test.js:362`; that code is unchanged and the test also fails on `main`, so it needs a fix there.
- `ledger-test.js`: 52 of 52.
- `livechecks-test.js`: all pass.
- Local rehearsal: 26 of 26 steps.

## Waiting for: DBA results (the next validation stage)
The DBA runs:
1. **Production checks 0–6**, following `docs/finance/live-checks/README.md`: the read-only `finance_checks` role and the loop that produces `result_00…06.txt`.
2. **The restored-production-copy rehearsal**, following `docs/finance/rehearsal/README.md` §0–9.

Results come back privately and are not committed.

**When the results arrive, the developer:**
- analyses each check and rehearsal step;
- records it in `DEPLOYMENT_READINESS.md` §2 and §4b, marking every line *verified*, *local-only* or *assumption*;
- lists inconsistencies, anomalies and blockers;
- re-states the go/no-go decision for the owner.

## Remaining blockers to deployment of 175/176
1. Live checks 0–6 run and analysed. Check 0 must show 174 with nothing applied.
2. The restored-copy rehearsal passing in full.
3. Backup/PITR confirmed, a test restore done, and a pre-deployment backup taken.
4. The owner's explicit approval to deploy.

## Accounting gates: no historical import or ledger posting until all three are approved
1. A written **EAS 48 principal-versus-agent** decision, per contract type.
2. A **separate** written **VAT-base** decision, per contract type.
3. An approved **historical commission-rate reconstruction methodology** (proposal in `DEPLOYMENT_READINESS.md` §7).

The database enforces gates 1 and 2: it refuses any entry without an approved policy that carries both approvals.

## Exact next steps
1. Owner: send `docs/finance/live-checks/` and `docs/finance/rehearsal/` to the DBA. Send `docs/finance/D01_ACCOUNTANT_REVIEW_PACK.md` to the accountant.
2. DBA: run checks 0–6 and the restored-copy rehearsal, and return the outputs privately.
3. Developer: analyse the results and update `DEPLOYMENT_READINESS.md` and this file.
4. Owner: decide GO or NO-GO. A deployment, if approved, follows `DEPLOYMENT_READINESS.md` §9 exactly.

Separately, each with its own approval and branch: the security plan P1–P3, and the HR test fix on `main`.

**Stopped here:** no deployment and no further implementation without the owner's approval.
