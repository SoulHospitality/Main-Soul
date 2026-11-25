# Migration Rehearsal: 175 and 176 on a Restored Production Copy

**Who:** an authorised database administrator, together with the developer.
**Where:** a **restored copy** of production. Use a new Supabase project restored from a backup or PITR, or a `pg_dump`/`pg_restore` into a scratch database. **Never production.** Every script that writes data refuses to run unless the session declares it is on a copy.
**Result:** fill in the rehearsal results table in `../DEPLOYMENT_READINESS.md` §4, and keep the outputs privately. Do not commit outputs from production data.

A local rehearsal of every step below has already passed on an in-process Postgres (PGlite) with seeded data: **26 of 26 steps, 45 of 45 behaviour checks** (including verified identity). The runner is in `local/`. A genuine test on a local **real PostgreSQL 17.5** server has also passed, **13/13**: restricted role, verified identity, bypass attempts, multi-session concurrency. It is `local/real-postgres-test.js`, with evidence in `evidence/real-postgres-roles-identity-2026-11-24.json`. The whole rehearsal also passes on the real server (`REHEARSAL_ENGINE=real node local/rehearsal.js`, 31/31), and `local/runbook-real.js` runs §1–§3 below exactly as written (old and new code through `compare-books.js`, the app's own migration runner), 9/9.

**Identity on the copy:** r3 needs no application key. It provisions a disposable rehearsal key itself, signs its claims in SQL (as the owner), and deactivates the key at the end. This runbook repeats the steps on real data.

**Two separate sources of change.** The branch carries two kinds of change, and this runbook keeps them apart:
- **The migrations (175/176)** must not change any existing data or any figure the app shows. They are checked with the **old code**: identical before and after.
- **The engine fixes (DEF-PL-01, DEF-BS-01, DEF-CLOSE-01, L4, L5)** intentionally change the displayed P&L, balance sheet and closing entries wherever a month has been closed. They are checked by running **old code vs new code on the same database**. Differences are expected, and each one must be explained.

## 0. Prepare
```bash
export REHEARSAL_DATABASE_URL='postgres://…restored copy…'   # never the production URL
git fetch origin && git checkout feature/finance-ledger      # code under test
cd Server && npm ci
# The code production runs today, for the "old code" runs (read-only export, no checkout needed):
mkdir -p /tmp/main-code && git archive origin/main Server | tar -x -C /tmp/main-code && (cd /tmp/main-code/Server && npm ci)
export OLD_SERVER=/tmp/main-code/Server
```
Confirm the copy is **not** production: different project ref or host, and app traffic does not use it.

## 1. Baseline (before migrations)
```bash
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/live-checks/00_deployment_state.sql    # expect 174, nothing applied
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/r1_fingerprint.sql > r1_before.txt
REHEARSAL_SERVER_DIR=$OLD_SERVER node ../docs/finance/rehearsal/compare-books.js 2026-10-01 2026-12-31 > books_old_before.json
node ../docs/finance/rehearsal/compare-books.js 2026-10-01 2026-12-31 > books_new_before.json
```
`books_old_before.json` against `books_new_before.json` is the **engine-fix effect** on real data, measured before any migration. Compare:
- `closes` month by month: every new closing entry must balance; list each month whose lines differ, and the accounts concerned;
- the trial balance rows;
- the P&L and balance sheet in the Financial System, old build vs new build.

Record every difference in `DEPLOYMENT_READINESS.md` §4b with its cause. An unexplained difference is a blocker.

## 2. Recovery from a failed migration
```bash
cd .. && psql "$REHEARSAL_DATABASE_URL" -f docs/finance/rehearsal/r5_partial_failure.sql   # run from repo root
```
All three lines must be 0: no ledger tables, no migration record, no posting setting. The injected failure has been fully rolled back.

## 3. Apply the migrations the way production will
Start the app against the copy. Its normal start-up runner applies 175 and then 176, each in one transaction:
```bash
cd Server && DATABASE_URL="$REHEARSAL_DATABASE_URL" PORT=5055 npm start
```
Expect `[db] Applied migration 175_commission_snapshots.sql` and `… 176_ledger_core.sql` in the log. Time the start-up: it is the deployment window. Stop and start once more; both migrations must be skipped.

**Integrations:** before starting, point integration settings in the copy's environment at test values or leave them unset, so the copy sends no emails, WhatsApp messages or Paymob calls. Use a local `.env` copy that has no production keys.

## 4. Verify structure, and that the migrations changed nothing existing
```bash
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/r2_verify_structure.sql   # every row passed = t
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/r1_fingerprint.sql > r1_after.txt
diff r1_before.txt r1_after.txt                     # only the "migrations >= 170" line may differ
# Migrations effect: SAME (old) code before and after the migrations → must be identical.
REHEARSAL_SERVER_DIR=$OLD_SERVER node ../docs/finance/rehearsal/compare-books.js 2026-10-01 2026-12-31 > books_old_after.json
diff books_old_before.json books_old_after.json     # must be identical
# New code after the migrations must equal new code before them (the migrations add nothing to the books).
node ../docs/finance/rehearsal/compare-books.js 2026-10-01 2026-12-31 > books_new_after.json
diff books_new_before.json books_new_after.json     # must be identical
```
Do **not** compare old code with new code here: those differences are the engine fixes, handled in §1.

## 4b. Restricted role, verified identity and concurrency on the copy
1. **Create the restricted role and an identity key** on the copy, following `../db-security/README.md` steps 2–3. Use a rehearsal-only password and key, never production ones.
2. **Restart the copy's app** with `DATABASE_URL` = `soul_app` on the copy and `MIGRATION_DATABASE_URL` = the owner URL. Set `LEDGER_IDENTITY_KEY_ID` / `LEDGER_IDENTITY_KEY` to the rehearsal key. Repeat the §5 smoke test: every page and write must work as `soul_app`.
3. **Check as `soul_app`:** reading `ledger_identity_keys`, TRUNCATE, `DISABLE TRIGGER`, `DROP TRIGGER`, `SET session_replication_role`, `SET ROLE` the owner, `CREATE OR REPLACE FUNCTION`, and UPDATE or DELETE of a posted entry must all be refused. The list matches `local/real-postgres-test.js`, which passed 13/13 against a local PostgreSQL 17.5.
4. **Concurrency:** in two `psql` sessions as `soul_app`, try to post the same idempotency key at the same time, and to insert two reversals of one entry. Exactly one may succeed in each case.
5. **Supabase specifics to note:** connection pooler mode (use transaction mode or a direct connection; the identity claim is transaction-local), and any default privileges set by `supabase_admin`. Re-run `ledger_roles.sql` if a grant is missing.

## 5. Existing application compatibility (manual, on the copy's app at port 5055)
Each of these must work exactly as on production. Note anything that does not:
- Log in. Open the Today board, unit status, the calendar and the reservations list.
- Create a reservation as **pending**, edit it, then **confirm** it. In SQL, check that `commission_snapshot_status = 'captured'`.
- Create a reservation directly as confirmed, through the website checkout flow if possible.
- Cancel a reservation. Check in and check out a stay.
- Record a payment and an expense. Open the Financial System: trial balance, P&L and owner statements for 2026-10 → today. **The figures must match `books_new_before.json`** (the app here runs the new code), except for the test transactions you just added.
- Close and reopen nothing; period freezing is out of scope.

## 6. Behaviour checks (writes test rows on the copy)
```bash
psql "$REHEARSAL_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "SET app.rehearsal_copy = 'restored-copy-not-production'" -f ../docs/finance/rehearsal/r3_behaviour.sql > r3.txt
```
psql gives `-c` and `-f` the same session, so the setting applies. The last two result sets must show **every** check passed (45 of 45) and 0 failed. These cover:
- capture with the applied rates;
- retries and duplicates;
- rate changes after confirmation;
- protection against hand-written snapshots;
- review flags;
- corrections, which must be by an admin with a separate approver, carry a reason, and go into a log that can't be changed;
- posting controls: switch off; separate D-01 and VAT approvals; a draft policy is refused; balance, immutability, no late lines, idempotency, and a one-time reversal mark.

## 7. Rollback with test entries present
```bash
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/rollback_176.sql           # must REFUSE (entries exist)
psql "$REHEARSAL_DATABASE_URL" -c "SET app.confirm_rollback_176 = 'drop-ledger-with-entries'" -f ../docs/finance/rehearsal/rollback_176.sql
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/rollback_175_soft.sql      # capture stops, snapshots kept
```
Restart the app **from `main`**, the build production runs today (it does not contain 175 or 176). Repeat the §5 smoke test, which must work. Then run the full rollback:
```bash
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/rollback_175_full.sql      # must REFUSE without confirmation
psql "$REHEARSAL_DATABASE_URL" -c "SET app.confirm_rollback_175 = 'drop-commission-snapshots'" -f ../docs/finance/rehearsal/rollback_175_full.sql
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/live-checks/00_deployment_state.sql   # back to 174
```

## 8. Rollback with no test entries (the normal pre-cutover case)
Start the app from `feature/finance-ledger` again, so 175 and 176 re-apply. Run `r2`, which must all pass. Then:
```bash
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/rollback_176.sql           # no confirmation needed: ledger empty
psql "$REHEARSAL_DATABASE_URL" -f ../docs/finance/rehearsal/r1_fingerprint.sql > r1_rolled.txt
```
`r1_rolled.txt` must match `r1_after.txt`, apart from the rehearsal test rows, which the fingerprint excludes.

## 9. Record
Fill in `DEPLOYMENT_READINESS.md` §4:
- the date and who ran it;
- the copy's backup or PITR timestamp;
- the start-up migration time;
- the pass counts for r2 and r3;
- the diff results and the smoke-test notes.

Then delete the copy.

## Rollback order in production (if ever needed)
1. Redeploy the previous build (`main`, without the 175 and 176 files).
2. Then run the rollback SQL.

The reverse order would let the app re-apply the migrations on its next start. The soft rollback (`rollback_175_soft.sql`) is safe in any order and loses nothing.
