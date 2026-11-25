# Ledger Database Security: Restricted Role and Verified Identity

**For:** the DBA and the developer. **Where:** first the restored copy, then production, and only after the owner approves deployment.
**What it closes:** review finding H3 (identity was a caller-supplied claim) and the restricted-posting-role blocker. Both mechanisms are implemented in migrations 175/176, `Server/src/lib/accounting/identity.js` and `Server/src/config/db.js`. **They protect production only once the steps below are done there.**

## How it works
1. **Restricted application role (`soul_app`).** The application connects as a role that owns nothing, is not a superuser, cannot create roles, and does not bypass row-level security. Because it owns no table, it cannot `ALTER`, `DROP`, `DISABLE TRIGGER`, set `session_replication_role`, `SET ROLE` the owner, or create or replace functions. It has no privilege at all on `ledger_identity_keys`. Migrations keep running as the owner, through `MIGRATION_DATABASE_URL`.
2. **Verified identity.** For any ledger action that names a person (manual, adjustment and reversal entries, the posting switch, period close and reopen, policy recording and approvals, commission corrections), the application signs a short-lived claim in the same transaction: `v1.<key>.<staff id>.<transaction id>.<expiry>.act.<HMAC-SHA256>`.
   - The key is in the application environment (`LEDGER_IDENTITY_KEY`), and a copy is in `ledger_identity_keys`.
   - `ledger_verified_actor()` is `SECURITY DEFINER`. It reads that copy and accepts the claim only if the signature, the transaction and the expiry all match.
   - `soul_app` can't read the key, so a holder of the database credentials **alone** can't produce a valid claim.
3. **Approvals by the approver.** A second person's approval (policy D-01, policy VAT, closed-period adjustment, commission correction) is a row the approver records in their **own** verified transaction, before the action. The database refuses the action without it, and refuses an approver who is the actor or the recorder.

**What it does not do.** The database trusts the application's signing key. The application must sign only for the user authenticated by the JWT (`req.user.id`). A compromise of the application server, or of its environment, would let an attacker sign as anyone: that is the remaining trust boundary, and it is the same one the app already has for its own JWT secret.

## Steps (restored copy first)
1. **Migrations** as the owner: start the app with `MIGRATION_DATABASE_URL` = owner URL (or apply them as in the rehearsal runbook).
2. **Create the restricted role**, with a strong password generated outside the repository:
   ```bash
   psql "$OWNER_DATABASE_URL" -v ON_ERROR_STOP=1 -v app_password="$SOUL_APP_PASSWORD" -f docs/finance/db-security/ledger_roles.sql
   ```
   The final query must show `soul_app` with every attribute false, `can_read_identity_keys = f` and `can_truncate_entries = f`.
3. **Provision an identity key** (`provision_identity_key.sql`, steps in its header). The same 32-byte hex secret goes into the database and into the application environment (`LEDGER_IDENTITY_KEY_ID`, `LEDGER_IDENTITY_KEY`). Never commit or paste it.
4. **Switch the application's connection:** `DATABASE_URL` → `soul_app`; `MIGRATION_DATABASE_URL` → owner. On Supabase, use the pooler connection string with the `soul_app` user.
5. **Smoke test as `soul_app`:** the full app smoke test (rehearsal runbook §5). Every page and write must work. Policies from step 2 give `soul_app` access to every app table (RLS is on everywhere since migration 095).
6. **Re-run `ledger_roles.sql` after any later migration.** It is idempotent, and it gives new tables their `soul_app` policy.

## Evidence so far (local only)
`docs/finance/rehearsal/local/real-postgres-test.js` on a **real PostgreSQL 17.5** server: all migrations, these scripts, and the posting service running as `soul_app`. **13 / 13.** Evidence: `rehearsal/evidence/real-postgres-roles-identity-2026-11-24.json`.
- **Normal operations:** PMS writes work as `soul_app`, including the snapshot trigger.
- **Refused for `soul_app`:** reading or editing keys, TRUNCATE, `DISABLE`/`DROP TRIGGER`, `session_replication_role`, `SET ROLE postgres`, creating or replacing functions, and forging log or correction rows.
- **Forgery:** forged signatures and claimed ids are refused; approvals can't be recorded in someone else's name.
- **The verified path works:** policy approval, switch-on with the verified actor logged, and manual entries.
- **Concurrency:** 20 concurrent same-key posts give one entry; 20 with different content give 1 entry and 19 conflicts; 10 concurrent reversals give one.

**Not yet verified:** Supabase specifics on the restored copy, such as pooler behaviour with `set_config(…, true)` inside transactions and default privileges set by `supabase_admin`. Use the transaction pooler or a direct connection; session-level settings are not used.
