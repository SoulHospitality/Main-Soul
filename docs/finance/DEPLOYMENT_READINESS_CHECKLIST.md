# Deployment Readiness Checklist: Finance Ledger (migrations 175, 176)

**Rule:** nothing on `feature/finance-ledger` is deployed to production until every *Required* line is ticked and the owner gives explicit approval to deploy. Approval to commit or push is not approval to deploy.

**How migrations reach production:** the server applies any new file in `Server/supabase/migrations` when it starts (`src/config/db.js`), each file in its own transaction. **Merging this branch into the deployed branch therefore deploys both migrations on the next restart.** Do not merge until this checklist is complete.

## 1. Production database checks (read-only)
| | Item | Status |
|---|---|---|
| Required | An authorised person ran `docs/finance/live-checks/01–06` under a SELECT-only role | ☐ Not run |
| Required | Results recorded in `DATA_MIGRATION_PLAN.md` Step 0 | ☐ |
| Required | Check 2 (USD without a rate), check 3 (duplicate payment references) and check 6 (unbalanced frozen months) are each resolved or accepted in writing | ☐ |
| Required | Check 5 output reviewed: it sizes the commission review list | ☐ |

## 2. Migration 175: commission snapshots
This migration changes how new confirmations behave, so it is the one that needs production validation.

| | Item | Status |
|---|---|---|
| Done | The snapshot records the rate the engine actually applies, including the 20% default, the owner-booked rate in mode C and the tenant deduction rules. It is checked against `calcReservationFinancials` in 2,000 random cases; the only differences are the known ≤ 0.01 float rounding. | ✅ |
| Done | Retried or repeated confirmations do not re-capture: the snapshot stays byte-identical | ✅ |
| Done | Later rate changes do not alter a saved snapshot. Changes to the unit, salesperson or owner flag, and re-confirmation after cancellation, flag the stay for review. | ✅ |
| Done | No-one can write a snapshot by hand (insert, overwrite, or an invented snapshot on a historical stay). The status and time columns are protected. | ✅ |
| Done | Corrections: active admin only, approver must be a different person, reason of at least 10 characters. The database trigger writes the log, and the log cannot be edited or deleted. | ✅ |
| Done | Historical confirmed stays are never backfilled; they stay in `reservation_commission_review`. Stays created before go-live and confirmed afterwards are captured but flagged. | ✅ |
| Required | Dry run on a **restored copy of production**: apply 175, confirm one test reservation through each path (PMS form, website checkout, chatbot booking, channel import) and inspect its snapshot | ☐ |
| Required | On that copy: time `ALTER TABLE reservations … ADD CONSTRAINT` (a full-table check under a brief exclusive lock) and confirm it takes less than 1 s | ☐ |
| Required | On that copy: confirm the existing screens that edit reservations still save normally. A code search found no path that copies reservation rows or writes the snapshot columns. | ☐ |
| Known | The current reports and owner statements still use **live** rates until the ledger is switched on. The snapshot records the rate, but it does not yet change any figure shown. | Accepted, by design |

## 3. Migration 176: ledger core
| | Item | Status |
|---|---|---|
| Done | Additive only: new tables, triggers and settings. The only existing table it writes to is `financial_settings` (`ledger_posting = 'off'`, insert-if-absent). | ✅ |
| Done | Custom accounts are compatible: same `varchar(12)` codes and account groups | ✅ |
| Done | Applies cleanly over all 176 migrations (PGlite test) | ✅ |
| Required | On the restored copy: apply 176, confirm `ledger_accounts` contains every code from `chartOfAccounts.js` plus every custom account, and that `ledger_entries` is empty | ☐ |
| Required | Confirm that nothing posts: `ledger_posting = 'off'` and no code calls `postEntry` | ☐ |

## 4. Backup and rollback
| | Item | Status |
|---|---|---|
| Required | Supabase point-in-time recovery or a daily backup is enabled, and a restore has been tested once on a scratch project | ☐ |
| Required | A backup is taken immediately before deployment, and its id recorded here | ☐ |
| Required | Rollback rehearsed on the restored copy: drop trigger `reservations_commission_snapshot` (this stops capture with no data loss), and confirm the app works. The new columns and tables can stay, unused. | ☐ |
| Ready | Rollback SQL (to apply only as a reviewed migration): `DROP TRIGGER IF EXISTS reservations_commission_snapshot ON public.reservations;` | Written |

## 5. Accountant approval (D-01)
| | Item | Status |
|---|---|---|
| Required before posting or import (not before deploying 175/176) | Written decision 1 (EAS 48 presentation) and decision 2 (VAT base), per contract type, signed and dated | ☐ |
| Required | Entered as an *approved* `ledger_policies` version, with the approval reference | ☐ |

## 6. Commission history review
| | Item | Status |
|---|---|---|
| Required before import | Size of `reservation_commission_review` known (from check 5 or after deployment) | ☐ |
| Required before import | Owner decides how historical rates are established: contract, statement or audit log. Each is entered through a logged correction, never by bulk-applying today's rate. | ☐ |

## 7. Security
| | Item | Status |
|---|---|---|
| Done | Report: `docs/security/NPM_AUDIT_REMEDIATION.md` (12 findings). The critical finding (proxy-addr) is not reachable with `trust proxy = 1`. | ✅ |
| Recommended before deploy | Non-breaking batch (express 4.22.3, socket.io 4.8.4, `npm audit fix`, remove csv-parse) as its own change | ☐ |
| Recommended | xlsx attendance import moved to exceljs; nodemailer upgraded or removed | ☐ |
| Recommended | Escape user input in the inquiry notification email | ☐ |

## Sign-off
Owner approval to deploy: ________ Date: ________
