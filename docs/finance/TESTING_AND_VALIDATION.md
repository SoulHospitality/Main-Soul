# Testing and Validation

**Updated:** Phase 5B, 2026-11-24. Every result below is on **synthetic data**, in disposable local databases. Nothing has been run against production or a restored copy.

## Automated: `npm test`
| File | Tests | Covers |
|---|---|---|
| `src/lib/accounting/money.test.js` | 21 | Decimal arithmetic, rounding, allocation, VAT, commission split, refunds and FX, balance, reconciliation, a 2,000-case parity check against `calcReservationFinancials` |
| `src/lib/finance/ledgerEngine.regression.test.js` | 13 | DEF-CLOSE-01, DEF-BS-01, DEF-PL-01 (P&L with closed and open months), L4 (contra-independent close), L5 (303000 postings kept) |
| `src/lib/accounting/engineAdapter.test.js` | 7 | Exact copy and keys, USD effective rate, missing dollar figure refused, two-sided lines split, negatives moved, two-sided USD refused, unit dimension |
| `src/lib/finance/applyCancellation.test.js`, `cancelSettlement.test.js`, `paymentInput.test.js` | 14 | Existing finance tests (wired in by `3caa574`) |
| Other suites | 88 | Unchanged |

**The one failure:** `hrRules.test.js:362`.
- **Cause:** commit `ad8515f` made operations staff subject to office attendance, and the test was not updated.
- **Status:** an HR decision; the HR code is unchanged.

**Coverage** (unit tests only, `--experimental-test-coverage`): `commissionCalc` and `money` 100%, `engineAdapter` about 96%. `ledgerEngine.js` is low (about 22% at the last measurement). `posting.js` is covered only by the database suites, whose coverage is not measured.

## Database suites (PGlite: an in-process Postgres with all 176 migrations; single connection)
Location: `docs/finance/rehearsal/local/`.

| Suite | Result | Covers |
|---|---|---|
| `ledger-test.js` | **119 / 119** | All posting and database controls, including every Phase 5B finding: H1, H2, M1, M2, M3, M6, M7, L1, L6, L7, L8 |
| `engine-validation.js` | **43 / 43** | Engine economics, statements, stored-ledger parity |
| `security-test.js` | **20 / 20** | Roles, page grants, the switch not reachable through the API, injection, owner isolation |
| `rehearsal.js` | **26 / 26 steps** (r2 15/15, r3 41/41) | Apply, partial failure, rollback, re-apply. Evidence goes to the OS temp folder, outside the repo |
| `livechecks-test.js` | all pass | Live checks 0–6 |

PGlite has a single connection, so concurrency there is **only simulated** (for example, a client that hides a row to force the race branch).

## Genuine multi-session test (real PostgreSQL 17.5)
`docs/finance/rehearsal/local/concurrency-test.js` starts a local **embedded PostgreSQL 17.5 server** (`embedded-postgres`, installed outside the project). It applies all 176 migrations the way the app does, and runs **separate concurrent connections**. Result: **7 / 7**. Evidence: `rehearsal/evidence/real-postgres-concurrency-2026-11-24.json`.
- 20 concurrent posts with the same key and content: one entry.
- 20 concurrent posts with the same key and different amounts: one entry, 19 conflicts.
- 10 concurrent reversals: one reversal.
- Two raw sessions inserting reversals: the second is refused by the unique index.
- A non-owner role is refused TRUNCATE, `DISABLE TRIGGER`, `DROP TRIGGER`, `session_replication_role` and UPDATE.
- The owner role can disable triggers.

This is **not** Supabase and **not** the restored copy. The restored-copy rehearsal repeats it (runbook §4b).

## Before any data-changing step
1. Live checks 0–6.
2. The restored-copy rehearsal, including the old-vs-new-code engine comparison, the concurrency and role checks, and rollbacks.
3. The restricted posting role, and a session-bound identity design (H3).
4. A dry-run import reconciled to zero unexplained breaks, then the accountant's sign-off and a one-month parallel run.

## Not yet covered
- Fixtures for insurance, vendor invoices, recurring charges, petty cash, housekeeping orders and holdbacks.
- An automated Paymob webhook test.
- Coverage of the database suites.
- Load testing.
- Segregation-of-duties tests beyond admin-only approvals (D-14).
- Contra P&L accounts in the P&L totals (`pnlFromBalances` follows the contra sign convention; none exist today).
