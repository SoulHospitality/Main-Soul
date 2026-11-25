# Testing and Validation

**Updated:** 2026-11-25 (development complete). Every result below is on **synthetic data**, in disposable local databases. Nothing has been run against production or a restored copy.

## Automated: `npm test`
| File | Tests | Covers |
|---|---|---|
| `src/lib/accounting/money.test.js` | 21 | Decimal arithmetic, rounding, allocation, VAT, commission split, refunds and FX, reconciliation, 2,000-case parity check |
| `src/lib/finance/ledgerEngine.regression.test.js` | 15 | DEF-CLOSE-01, DEF-BS-01, DEF-PL-01, L4, L5, DEF-SRC-01 (query errors surface), DEF-ACC-01 (unknown accounts reported) |
| `src/lib/accounting/engineAdapter.test.js` | 7 | Lossless engine → ledger copy |
| `src/config/paymob.test.js` | 4 | Paymob HMAC against the documented field order; altered fields, wrong or truncated signatures rejected; fails closed without the secret |
| `src/lib/accounting/identity.test.js` | 6 | Claim format and HMAC, binding to actor, transaction and expiry, configuration checks, no acting without a key |
| `src/lib/finance/applyCancellation.test.js`, `cancelSettlement.test.js`, `paymentInput.test.js` | 14 | Existing finance tests |
| Other suites | 88 | Unchanged |

On the trial merge of all three branches (`MERGE_AND_DEPLOYMENT_PACKAGE.md`): 171 tests, 170 pass (the same HR failure).

**Result:** 155 tests, 154 pass. The one failure is `hrRules.test.js:362`: commit `ad8515f` changed the attendance rule and the test was not updated. That is an HR decision; the HR code is unchanged.

## Database suites (PGlite: an in-process Postgres with all migrations; single connection)
Location: `docs/finance/rehearsal/local/`.

| Suite | Result | Covers |
|---|---|---|
| `ledger-test.js` | **139 / 139** | Every posting and database control, Phase 5B findings, verified identity (H3): forged, replayed or expired claims, ignored `app.actor_id`, approvals, forged log rows |
| `engine-validation.js` | **43 / 43** | Engine economics, statements, stored-ledger parity |
| `engine-validation-extra.js` | **23 / 23** | Insurance, cancellation forfeit, vendor invoice with WHT, recurring charge, petty cash, housekeeping order, holdback, payout; statements and parity with every scenario; a real query failure surfaces |
| `paymob-webhook-test.js` | **11 / 11** | Webhook end to end: HMAC, unknown order, failed payment, amount mismatch, success, duplicate callbacks, dates taken meanwhile, fails closed |
| `security-test.js` | **20 / 20** | Roles, page grants, API cannot flip posting, injection, owner isolation |
| `rehearsal.js` | **33 / 33 steps** (r2 18/18, r3 45/45) | r0 inventory, apply, partial failure, rollback, re-apply; r3 signs its own claims with a disposable key. Also runs on a real server (below) |
| `livechecks-test.js` | all pass | Live checks 0–6 |
| (inline) `r0_table_inventory.sql` | checked | Same database twice gives identical output; one changed row flags exactly that table |

PGlite has a single connection, so concurrency there is only simulated.

## Real PostgreSQL 17.5 (genuine; local embedded server)
`docs/finance/rehearsal/local/real-postgres-test.js`, **13 / 13**. It applies all migrations as the owner, runs `db-security/ledger_roles.sql` and `provision_identity_key.sql`, and runs the posting and identity code **as the restricted role `soul_app`** over separate, truly concurrent connections. Evidence: `rehearsal/evidence/real-postgres-roles-identity-2026-11-24.json`.

The earlier `concurrency-test.js` (7/7, owner role, evidence `real-postgres-concurrency-2026-11-24.json`) is superseded by this test.

This is **not** Supabase and **not** the restored copy; the rehearsal runbook repeats it there (§4b).

Also on the real server (2026-11-25):
- `REHEARSAL_ENGINE=real node rehearsal.js`: **33 / 33**, the same steps as on PGlite. Evidence: `real-postgres-rehearsal-2026-11-25.json`.
- `runbook-real.js`: **8 / 8**. Runbook §1–§3 with `compare-books.js` as a CLI on old (`main`) and new code, and the app's own migration runner on `MIGRATION_DATABASE_URL`; the old close's DEF-CLOSE-01 defect shows up on real data shapes. Evidence: `real-postgres-runbook-2026-11-25.json`.

## Financial System ledger screens (2026-11-25)
- `rehearsal/local/ledger-ui-api-test.js`: **21 / 21** (PGlite). Before and after 175/176, role refusal, identity key never returned, drafts never count as approved, review list and counts, `integrity` in reports, read-only.
- `rehearsal/local/ui-e2e.js`: the real server on real PostgreSQL 17.5, Vite and headless Chrome. Ledger controls, Commission review and the statements warning in English and Arabic: no page errors and no untranslated keys. Screenshots: `docs/finance/ui/`.

## Phases 4–6 tooling (2026-11-25; synthetic data)
- `rehearsal/local/migration-test.js`: **31 / 31** (PGlite). Historical migration plan, execute, reconcile and parallel-run sync, with every refusal.
- `rehearsal/local/migration-cli-real-test.js`: **14 / 14** (real PostgreSQL 17.5). `scripts/ledger-migration.js` as the DBA runs it.
- `rehearsal/local/activation-test.js`: **31 / 31** (PGlite). Migration 177 guards; reports from the stored ledger identical to the engine (trial balance, P&L, balance sheet, month-end close); the reversal procedure; tested rollback (`rollback_177` → `rollback_176`).

## Phase 7 monitoring (2026-11-25)
- `rehearsal/local/monitor-test.js`: **19 / 19**. Nightly reconciliation recorded only while live, the permanent history, the Data health exception (never, differences, stale), Reconcile now (roles, who ran it), Ledger controls history, and the job started with the server.

## Accountant's decisions and go-live (2026-11-25)
- `rehearsal/local/accountant-decisions-test.js`: **15 / 15**. VAT suspended by date, read from the database: no output or input VAT after the date, earlier periods unchanged, resumable. Refunds reverse revenue (R-1); forfeits split owner and company (R-5); the owner subledger ties.
- `engine-validation.js`: **45 / 45**. The refund characterisation was replaced by the R-1 treatment: the reversal is proportional and adds up exactly.
- `migration-test.js`: **34 / 34**. The treatment check follows the VAT suspension; ranges that straddle the date are refused.
- `rehearsal/local/golive-real-test.js`: **20 / 20** (real PostgreSQL 17.5). The full go-live through the operator tools: deploy, settings, approvals and refusals, posting, sync and reconciliation from 25/11, no VAT, R-1 and R-5 in the books, reports from the ledger, monitoring, control log.

## Not yet covered
- Coverage measurement of the database suites.
- Load testing.
- Segregation-of-duties tests beyond admin-only approvals (D-14).
