# Posting Controls Audit

**Scope:** `Server/src/lib/accounting/posting.js` and the database controls in migrations 175 and 176 (uncommitted Phase 5B; never applied anywhere).
**Evidence:**
- **PGlite suites (local, synthetic data):** `rehearsal/local/ledger-test.js` **119 of 119**; rehearsal `r3_behaviour.sql` **41 of 41**; `rehearsal.js` **26 of 26** steps; `security-test.js` **20 of 20**.
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

## Unresolved (blockers; not closable in code alone)
1. **H3: identity is a claim, not proof.** Every staff id the database receives is supplied by the application over one shared connection role: `app.actor_id`, `approved_by`, `vat_approved_by`, `created_by`, `closed_by`, `reopened_by`, and the commission corrector and approver. The checks prove the **named** person is an active admin, and that approver and recorder differ. They **cannot** prove the session belongs to that person; any session can name anyone (demonstrated in the pre-commit review). This is **attribution, not authentication**.
   - **Required before posting:** the restricted role (item 2), plus identity claims the database can verify, such as an HMAC-signed `(actor, txid, expiry)` checked by a `SECURITY DEFINER` function whose key the application role cannot read.
   - **Until then:** the application must pass only `req.user.id` from the verified JWT.
2. **Database owner role.** The real-Postgres test shows an ordinary non-owner, non-superuser role is refused TRUNCATE, `DISABLE TRIGGER`, `DROP TRIGGER`, `session_replication_role` and edits of posted entries. The **owner** role can still disable triggers, and today the app connects as the owner. Posting must run under a restricted role before it is enabled. On Supabase, `session_replication_role` needs a superuser; whether the project's `postgres` role can set it must be checked on the restored copy.
3. **Concurrency on the target platform.** The genuine multi-session test ran on a local PostgreSQL 17.5 server, not on Supabase or the restored copy. It is repeated in the restored-copy rehearsal (runbook §4b).
4. **Admin-only approvals** stand in until D-14 (segregation of duties). Changing them means editing `ledger_is_active_admin` and the 175 trigger.
5. **Entry numbers** come from a sequence: unique, with gaps after failed or duplicate attempts. If the accountant requires gapless numbering, numbering must move to a per-year counter inside the transaction.
6. **Existing finance routes** (computed books) still allow open-month edits and deletes (audit L2) until the stored ledger is authoritative.
