# Posting Controls Audit

**Scope:** `Server/src/lib/accounting/posting.js` and the database controls in migrations 175 and 176 (uncommitted Phase 5B; never applied anywhere).
**Evidence:**
- **PGlite suites (local, synthetic data):** `rehearsal/local/ledger-test.js` **139 of 139**; rehearsal `r3_behaviour.sql` **45 of 45**; `rehearsal.js` **26 of 26** steps; `security-test.js` **20 of 20**.
- **Real PostgreSQL 17.5 (local embedded server, synthetic data):** `rehearsal/local/concurrency-test.js` **7 of 7**, a **genuine** multi-session test.

**Principle:** every control that matters is enforced **in the database**, so no route, script or future code path can bypass it. The service adds clear error codes on top. **Limits:** §"Unresolved".

| Control | Service (`posting.js`) | Database | Test |
|---|---|---|---|
| Posting switch | `POSTING_OFF` | No entry while `ledger_posting` ≠ `on`. Switching on needs an approved policy, a claimed active-admin `app.actor_id` and `app.control_reason`. The switch cannot be deleted, renamed, or have a row renamed into it; it takes only on/off; every change goes to the append-only `ledger_control_log` | ledger-test, r3 |
| Approved policy | `NO_POLICY`, `POLICY_NOT_IN_FORCE` | The entry must carry **the policy in force** on its date (`ledger_policy_in_force`: the latest approved policy effective on or before it). A reversal keeps its original's policy, even if since retired. One approved policy per effective date | ledger-test M2, M3 |
| Policy approval | — | Both approvals (D-01 and VAT) with references; approvers are active admins; neither is the recorder (`created_by`); a policy cannot be created as retired; approved policies are permanent (retire only) | ledger-test M7, r3 |
| Balance | `UNBALANCED` (exact Decimal) | Deferred constraint: base debits = credits, at least 2 lines | ledger-test, r3 |
| One side, non-negative | `ONE_SIDE`, `NEGATIVE` | `CHECK` per line | ledger-test |
| Accounts | `UNKNOWN_ACCOUNT`, `INACTIVE_ACCOUNT`, `CURRENCY_NOT_ALLOWED` | FK; a used account's code, type, normal balance and currency are fixed and it cannot be deleted; new or removed custom accounts are synced (removed ones only deactivated) | ledger-test M6, L8 |
| Period = date | — | `CHECK (period = to_char(transaction_date,'YYYY-MM'))` | ledger-test |
| Idempotency | Same key + same content → the existing entry; same key + different content → `IDEMPOTENCY_CONFLICT`. The fingerprint covers date, description, source, version, origin, links, policy, approver and every line field. A lost race whose winner is invisible → `IDEMPOTENCY_RACE` (retryable) | `UNIQUE (idempotency_key)`; `ON CONFLICT DO NOTHING` | ledger-test L1, L6; **real Postgres: 20 concurrent posts → one entry** |
| Atomicity | Runs in the caller's transaction when given one | Lines only in the creating transaction | ledger-test |
| Immutability | — | No UPDATE or DELETE of entries or lines; no TRUNCATE of any ledger table, `financial_settings` or the commission correction log; the only update is marking an entry reversed, once, by its own reversal; no lines added later | ledger-test H1, r3; real Postgres (non-owner role) |
| Reversal | `NO_REASON`, `ALREADY_REVERSED`, `REVERSAL_OF_REVERSAL`, `BAD_DATE`; copies the original EGP amounts exactly | One reversal per entry (unique index); must mirror the lines; not before the original; not of a reversal | ledger-test M1, L7; **real Postgres: 10 concurrent reversals → one; two raw sessions → second refused** |
| Replacement | `replaceEntry`, atomic | One replacement per entry (unique index); must point at a reversed entry | ledger-test M1 |
| Period locking | `PERIOD_CLOSED` | Closed period: only an adjustment with an approver who is a different active admin; close and reopen attributed; reopening needs a reason; closed periods cannot be edited or deleted | ledger-test |
| Commission corrections (175) | Admin; a different-admin approver; a reason | The trigger enforces them and writes the log; the log cannot be changed, deleted or truncated | ledger-test, r3 |
| Bypass by application routes | — | No route writes `ledger_*`, `commission_snapshot*` or `ledger_posting`; the settings API whitelists `gateway_mdr_pct` | security-test |

## Identity and the restricted role (H3): implemented, verified locally, not yet deployed
1. **Verified identity.** Identity is no longer a caller-supplied id. Every ledger action that names a person needs a **signed claim bound to the current transaction**: `ledger_verified_actor()` checks an HMAC-SHA256 made with a key the application holds (`Server/src/lib/accounting/identity.js`). This covers manual, adjustment and reversal entries, the posting switch, period close and reopen, policy recording, and commission corrections.
   - **Approvals:** a second person's approval is a row the approver records in their own verified transaction (`ledger_approvals`). It is required by the action, and must come from a different person.
   - **Tests:** RFC 4231 HMAC vectors, forged, replayed and expired claims, ignored `app.actor_id`, approvals in someone else's name, and forged log rows: `ledger-test.js` H3 block.
2. **Restricted role.** `docs/finance/db-security/ledger_roles.sql` creates `soul_app` (owns nothing; no superuser, CREATEROLE or BYPASSRLS; no access to the keys). It gets RLS policies on app tables and narrow ledger grants. `config/db.js` runs migrations on `MIGRATION_DATABASE_URL`.
   - **Real PostgreSQL 17.5** (`real-postgres-test.js`, 13/13): the service as `soul_app` works; every bypass is refused by the database's own permission system; concurrency holds.
3. **What remains (external, deployment-time):**
   - run `ledger_roles.sql` and `provision_identity_key.sql` on the restored copy and then production;
   - switch `DATABASE_URL` to `soul_app`;
   - store the key in the application environment.

   Until that is done on a given database, the app connects as the owner there, which can read the key and disable triggers. **H3 is not closed for production until then.**
4. **Trust boundary that stays.** The database trusts the application's signing key. The app must sign only for the JWT-authenticated user (`req.user.id`). A compromised application server or environment could sign as anyone.

## Other limits
- **Concurrency on the target platform.** The genuine multi-session test ran on a local PostgreSQL 17.5 server, not on Supabase or the restored copy. It is repeated in the restored-copy rehearsal (runbook §4b).
- **Admin-only approvals** stand in until D-14 (segregation of duties). Changing them means editing `ledger_is_active_admin` and the 175 trigger.
- **Entry numbers** come from a sequence: unique, with gaps after failed or duplicate attempts. If the accountant requires gapless numbering, numbering must move to a per-year counter inside the transaction.
- **Existing finance routes** (computed books) still allow open-month edits and deletes (audit L2) until the stored ledger is authoritative.
