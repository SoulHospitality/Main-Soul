# HANDOFF: Financial reconstruction

**Updated:** 2026-11-24 · **Branch:** `feature/finance-ledger`, pushed after each phase. `main` is untouched (`ff782cd`).
**Decision: NO-GO.** Not merged, not deployed, posting **off**, no historical import, reports not switched to the stored ledger, production untouched.

## Commits
| Commit | Content |
|---|---|
| `6955687` | Foundation: documents, money layer, migrations 175/176, decimal.js |
| `b9d56fe` | Migration 175 hardening, D-01 pack |
| `9e74bb4` | Readiness controls, rehearsal kit, live check 0 |
| `f743ac8` | HANDOFF and readiness hash |
| `3caa574` | Report fixes DEF-PL-01, DEF-BS-01, DEF-CLOSE-01, with regression tests |
| `97eec90` | Phase 5B: ledger controls H1, H2, M1–M3, M6, M7, L1–L10; runbook separates migration from engine-fix effects; genuine multi-session test |
| (this commit) | Phase 6: verified identity (H3), restricted role, API lockdown |

## Phase 6: verified identity and restricted role
- **Verified identity (H3), in migrations 175/176:**
  - every ledger action that names a person needs a **signed claim bound to the current transaction**, checked by the `SECURITY DEFINER` function `ledger_verified_actor`. HMAC-SHA256 is built on the built-in `sha256()`, so no extension is needed;
  - approvals are recorded by the approver in their own verified transaction (`ledger_approvals`);
  - caller-supplied ids (`app.actor_id` and the like) are no longer trusted;
  - the control log and correction log accept rows only from their guard triggers;
  - identity keys can only be deactivated, never changed or truncated.
- **App side:**
  - `Server/src/lib/accounting/identity.js` (sign, attest, `recordApproval`);
  - `posting.js` attests every named actor and gains `setPostingSwitch`;
  - `commissionSnapshots.js` attests the corrector.
- **Restricted role:**
  - `docs/finance/db-security/ledger_roles.sql` creates `soul_app` (owns nothing; not superuser; no CREATEROLE or BYPASSRLS; no key access), with RLS policies on app tables and narrow ledger grants;
  - `provision_identity_key.sql` stores the key;
  - `Server/src/config/db.js` runs migrations on `MIGRATION_DATABASE_URL` when set, and is otherwise unchanged.
- **API lockdown:** the new ledger tables and the correction log get RLS on and no `anon`/`authenticated` access, like migration 095.
- **Tests:**
  - `npm test` 149, 148 pass (the HR test fails, as before);
  - PGlite: ledger 139/139, engine 43/43, security 20/20, rehearsal 26/26 (r3 45/45), live checks pass;
  - **real PostgreSQL 17.5 as `soul_app`: 13/13**, covering normal PMS writes, every bypass refused, forgery refused, the verified path, and concurrency.

**H3 status:** implemented and verified locally. **Not active on any real database** until the DBA steps in `docs/finance/db-security/README.md` are done there (role, key, `DATABASE_URL` switched to `soul_app`). The remaining trust boundary is the application's signing key.

## Blockers (external)
1. Live checks 0–6 on production.
2. The restored-copy rehearsal, including the old-vs-new-code engine comparison, the restricted role and identity setup, and concurrency on the copy.
3. Backup and restore validation.
4. On the target databases: the restricted role, the identity key, and the connection switch.
5. Accountant (before posting or import): the EAS 48 decision; a separate VAT-base decision; the commission methodology.
6. The owner's approval to deploy; separate authorisation to merge.

## Next development phases (in progress)
1. Integration coverage and missing accounting scenarios.
2. Paymob webhook tests.
3. Engine error handling.
4. Rehearsal and backup preparation.
5. Final accountant and DBA packages.
6. Deployment readiness.
