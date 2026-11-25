# DBA Review Package

**For:** the authorised database administrator. **Scope:** everything the DBA runs before and during deployment, in order. Production is touched only by read-only scripts until the owner gives written GO; deployment itself is the owner's decision.
**Code under review:** branch `feature/finance-ledger` (see `HANDOFF.md` for the current commit). Production runs `main` (`ff782cd`).

## Order of work
| Step | What | Where | Touches production? | Return |
|---|---|---|---|---|
| 1 | Read-only check 0 (deployment state) and checks 1–6 (data quality) | `live-checks/README.md` | **Read-only** (SELECT-only role, read-only transactions) | `result_00…06.txt`, privately |
| 2 | Backup and restore validation: restore into a separate project; prove it is complete | `rehearsal/BACKUP_RESTORE_VALIDATION.md` (with `rehearsal/r0_table_inventory.sql`) | **Read-only** inventory on production; the restore goes to a new project | Restore point, duration, inventory diff result |
| 3 | Rehearsal on the restored copy: engine-fix comparison (old vs new code), migrations, structure, behaviour, rollback, failure recovery | `rehearsal/README.md` §0–9 | No | The pass counts and diffs in `DEPLOYMENT_READINESS.md` §4b |
| 4 | Restricted role and verified identity on the copy; smoke test as `soul_app`; concurrency and bypass checks | `db-security/README.md`; rehearsal §4b | No | Results of each check |
| 5 | Review the scripts themselves: migrations 175/176, `db-security/ledger_roles.sql`, rollback scripts | `Server/supabase/migrations/17[56]_*.sql`, `rehearsal/rollback_*.sql` | No | Comments or sign-off |
| 6 | **Only after the owner's written GO:** backup, then deployment sequence, then role and key setup on production | `DEPLOYMENT_READINESS.md` §9; `db-security/README.md` | **Yes** | Deployment record |

## What each script does to data
| Script | Writes? |
|---|---|
| `live-checks/00…06.sql`, `rehearsal/r0_table_inventory.sql`, `rehearsal/r1_fingerprint.sql`, `rehearsal/r2_verify_structure.sql` | No (read-only transactions) |
| `rehearsal/r3_behaviour.sql` | Test rows **on a restored copy only**; refuses to run without the copy declaration |
| `rehearsal/r5_partial_failure.sql` | Applies 176 and rolls it back (copy only) |
| `rehearsal/rollback_175_soft.sql` / `_full.sql` / `rollback_176.sql` | Remove migration objects (the full versions need explicit confirmation) |
| `db-security/ledger_roles.sql` | Creates the role, grants and RLS policies (idempotent) |
| `db-security/provision_identity_key.sql` | Inserts one identity key |
| Migrations 175/176 (applied by the app's start-up runner) | Additive objects; they change no existing row (proven by the r1 fingerprint) |

## Points that need a DBA's judgement (Supabase)
- **Pooler:** transaction mode or a direct connection. The identity claim is transaction-local (`set_config(…, true)`); no session state is relied on.
- **Default privileges:** set by `supabase_admin` for `anon`/`authenticated`. The migrations revoke them on the new tables and enable RLS (as migration 095 did for the rest). Confirm on the copy with `\dp ledger_*`.
- **`soul_app` password and the identity key:** generated outside the repository and stored only in the platform's secret settings. Never paste them into tickets or chat.
- **Retention and PITR window:** state them in the backup record.

## Evidence already available (local only; synthetic data)
- PGlite suites: ledger 139/139, engine 43/43 + 23/23, security 20/20, rehearsal 33/33 (r3 45/45), Paymob 11/11, live checks.
- **Real PostgreSQL 17.5:** 13/13 as `soul_app` (bypasses refused, verified identity, concurrency); the full rehearsal 33/33; runbook §1–§3 9/9, with `compare-books.js` on old and new code and the app's own migration runner on `MIGRATION_DATABASE_URL`. Evidence is in `rehearsal/evidence/`.
- `pg_dump`/`pg_restore` were not available locally, so the backup-and-restore step itself has only been prepared, not rehearsed.

None of this replaces the steps above on the real data and platform.
