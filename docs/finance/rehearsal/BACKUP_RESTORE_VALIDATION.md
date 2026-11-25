# Backup and Restore Validation

**For:** the DBA. **Purpose:** to prove, before deployment, that production can be restored completely. The restored copy is then used for the rehearsal (`README.md`).
**Status:** prepared and checked locally (the inventory script runs on the local test databases). **Not yet run on production or Supabase.** Nothing here writes to production.

## 1. Confirm backups exist (Supabase dashboard, production project)
- [ ] Point-in-time recovery (PITR) enabled, or daily backups. Record which, and the retention period: ________
- [ ] The most recent backup time: ________

## 2. Restore into a separate project
Restore the latest backup, or a PITR timestamp, into a **new, separate** Supabase project, never over production. Note:
- the restore point: ________
- the copy's project ref and host: ________

The copy must not be reachable by the live app; check that no production environment points at it.

## 3. Prove the copy is complete
Run the read-only inventory on both databases at the restore point:
```bash
psql "$PRODUCTION_URL_READONLY_OWNER" -v ON_ERROR_STOP=1 -f docs/finance/rehearsal/r0_table_inventory.sql > inventory_source.txt
psql "$REHEARSAL_DATABASE_URL"         -v ON_ERROR_STOP=1 -f docs/finance/rehearsal/r0_table_inventory.sql > inventory_copy.txt
diff inventory_source.txt inventory_copy.txt
```
- The inventory runs inside `BEGIN TRANSACTION READ ONLY` and prints only table names, row counts and md5 hashes, never row contents.
- Tables written after the restore point (sessions, logs, new bookings) may differ. **Every finance table must be identical:** reservations, payments, expenses, `cash_ledger`, `financial_*`, `owner_*`, `vendor_*`, `ar_*`, `petty_cash*`, `staff_users`.
- Also run `live-checks/00_deployment_state.sql` on both: the same last migration (174).

| Check | Result |
|---|---|
| All finance tables identical (count and hash) | ☐ |
| Other differences explained by writes after the restore point | ☐ |
| Same migration state | ☐ |
| Restore duration (the recovery-time estimate) | ___ min |

## 4. Prove the copy works
Run the app against the copy with **no** production keys: no email, WhatsApp or Paymob calls. Log in, open the Financial System, and check the trial balance for a closed month against the production screen.

## 5. Keep the evidence
- **Record:** who ran it, the date, the restore point, the duration and the diff result. Put these in `../DEPLOYMENT_READINESS.md` §5, and keep the raw outputs privately; don't commit them.
- **Same day as deployment:** take a fresh backup (or note the PITR time) immediately before deploying, and record its id.
