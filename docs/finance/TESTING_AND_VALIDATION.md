# Testing and Validation

## Automated (in `npm test`)
`Server/src/lib/accounting/money.test.js` has 19 tests covering:
- decimal arithmetic, and rejection of non-numbers;
- half-up rounding at the currency's decimals;
- largest-remainder allocation that always sums exactly;
- inclusive and exclusive VAT;
- commission splits from a snapshot (company, agent, owner remainder) and the error when no snapshot exists;
- refunds and FX conversion;
- the debit = credit assertion;
- reconciliation buckets (matched, amount break, timing break, ledger only, subledger only).

## Database tests (PGlite: every migration applied to an in-memory Postgres)
`ledger-test.js` (29 checks) covers:
- migrations 175 and 176 applying cleanly over the full migration chain;
- the chart seeded with the same codes as `chartOfAccounts.js`;
- posting refused while `ledger_posting = 'off'`;
- balanced posting and exact-balance rejection;
- the one-side-per-line rule, negative amounts, unknown or inactive accounts, and currency restrictions;
- USD lines without a rate being rejected;
- idempotent re-posting;
- the database blocking UPDATE and DELETE on entries and lines;
- reversal posting a mirror entry and marking the original only once;
- closed-period rejection;
- the deferred balance trigger catching an unbalanced direct insert;
- the trial balance;
- commission snapshots captured at confirmation, with a historical confirmed row left for review;
- an overwrite blocked outside a correction, and a logged correction being allowed.

`livechecks-test.js` runs the six live-check scripts on a migrated test database. It confirms they parse, that check 6 detects a seeded 0.01 imbalance, and that a write inside the read-only transaction is refused.

These harness scripts live outside the repository for now. Moving them into `Server/test/` with PGlite as a dev dependency is proposed for approval.

## Before any data-changing step
1. Run the live checks and review the results (`live-checks/README.md`).
2. Do a dry-run migration on a restored copy of production, then reconcile it (`DATA_MIGRATION_PLAN.md` Step 3) with zero unexplained breaks.
3. Get the accountant's sign-off on the reconciliation summary.
4. Run in parallel for one month.

## Not yet covered
- Event → posting rules for each financial event. These are blocked by D-01.
- Load and performance testing of `trialBalance` on a year of entries.
- Permission (segregation of duties) tests. These are blocked by D-14.
