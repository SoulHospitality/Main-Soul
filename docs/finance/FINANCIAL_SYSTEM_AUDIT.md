# Financial System Audit — Soul Hospitality PMS

**Date:** 2026-11-23 · **Scope:** `Server/src`, `Server/supabase/migrations` (001–174), `Client/src/admin` · **Status:** Phase 1 (read-only audit; no application code changed)

Every finding is tagged **[V]** verified in code or migrations, or **[A]** an assumption that still needs checking against the live database. The live database was not queried (direct production queries are not permitted from this environment), so data-quality figures (counts of nulls, negatives, duplicates) are listed as checks to run, not as results.

---

## 1. Summary

The brief assumes a basic system with `REAL` money columns and a naive `cash_ledger`. The actual system is considerably further along, and the gaps are different from the ones the brief expects:

| Brief assumption | What the code shows |
|---|---|
| Money stored as `REAL` | **Mostly fixed.** Migration `139_finance_money_and_payments.sql` converted every money-named `real`/`double` column to `numeric(14,2)` and exchange rates to `numeric(12,4)` [V]. Remaining: whole-pound `integer` columns on the guest booking side, and percentage columns still `real` [V]. |
| `cash_ledger` may be the ledger | **It is not.** The ledger is `lib/finance/ledgerEngine.js`. `cash_ledger` is a legacy side record nothing in the books reads [V]. |
| No double entry | **Double entry exists**, but it is **computed on every request** from operational tables, not stored as posted journals [V]. |
| No period closing | **Closing exists**: closed months are frozen into `financial_posted_entries`; later changes post as dated prior-period adjustments (IAS 8 style) [V]. |
| Paymob webhook unverified | **Verified**: HMAC checked, fails closed without the secret, amount must match the checkout session, duplicate deliveries ignored [V]. |

**The central gap:** the general ledger is not a stored, immutable record. It is rebuilt by `buildJournal()` from reservations, payments, expenses, etc. each time a report runs. Open months therefore change whenever an operational record, a unit's commission %, or a salesperson's commission % changes, and there is no journal number, posting date, poster, or reversal trail for open-month activity.

---

## 2. Architecture today [V]

```
Operational tables (reservations, payments, expenses, petty_cash, vendor_invoices, owner_payout_requests,
financial_manual_entries, ar_write_offs, financial_recurring_charges, housekeeping_service_orders)
        │  loadPortalData(from, to)                     lib/finance/ledgerEngine.js:970
        ▼
buildJournal(data, from, to)  → in-memory entries {id, date, type, lines[{account, debit, credit}]}
        │                                            lib/finance/ledgerEngine.js:1414
        ├─ closed months: replaced by frozen copies   lib/finance/periodFreeze.js
        ▼
balancesFromJournal → trialBalance / balanceSheet / pnl / cashFlow / ownerTrustSubledger / vatReturn
        ▼
routes/pms/financialSystem.js (84 routes)  →  Client/src/admin/pages/FinancialSystem.jsx
```

- **Engine:** `lib/finance/ledgerEngine.js` (~2,600 lines). Entry builders per event: `bookingEntry`, `stayRecognitionEntries` (revenue deferred by nights, 210000/111000), `collectionEntry`, `depositReclassEntry`, `cancelForfeitEntry`, `gatewaySettleEntry`, `expenseEntries`, `recurringEntries`, `vendorBillEntries`, `writeOffEntry`, `provisionEntries` (ECL allowance 105900/620000), `insuranceRefundEntry`, `agentAccrualEntry`, `closeMonthEntry`.
- **Chart of accounts:** `lib/finance/chartOfAccounts.js` (49 system accounts) + user-defined accounts in `financial_custom_accounts` (`lib/finance/customAccounts.js`, migration 115).
- **Periods:** `lib/finance/periodLock.js` (`assertPeriodOpen`, reopen with reason), `lib/finance/periodFreeze.js` (freeze on close, prior-period adjustments), `financial_period_closes` (migration 055).
- **Tax:** `lib/finance/taxEngine.js` — output VAT 14% on commission + cleaning, input VAT extraction 14/114, WHT 3% / 1%.
- **Reports:** statements, trial balance, cash flow, VAT return, owner trust subledger, aging, report builder (`lib/finance/reportBuilder.js`), Excel export (`lib/finance/financialExport.js`), forecast (`expenseForecast.js`, `paymentCalendar.js`).
- **Books epoch:** `lib/financialEpoch.js` (`FINANCE_BOOKS_START`, default 2026-10-01) and `lib/finance/booksReset.js` (`financial_settings.books_reset_at`) — records before the reset are ignored.
- **Frontend:** `Client/src/admin/pages/FinancialSystem.jsx` with tools: today, health, outstanding, collection, check-in audit, insurance, refunds, payment calendar, vendors, petty cash, owners, accounts, manual journals, reconcile, close, statements, report builder, tax, forecast. Plus `Commissions.jsx`, `Payrolls.jsx`, `PettyCash.jsx`, `Reports.jsx`, owner portal pages.

## 3. Financial event sources (writes) [V]

| Table | Written by |
|---|---|
| `payments` | `routes/payments.js:122` (Paymob webhook), `routes/pms/index.js:3033, 4113`, `routes/pms/financialSystem.js:1620, 3044`, `lib/settleReservationMoney.js:52`, `lib/reservationExtras.js:89`, `lib/finance/applyCancellation.js:42`; ops collections via `routes/pms/opsCheckins.js` |
| `expenses` | `routes/pms/index.js:3209, 3847, 4023`, `jobs/monthlySalaryExpenses.js:96` (salaries) |
| `petty_cash` | `lib/opsPettyCash.js:72`, `routes/pms/financialSystem.js:1211`, `routes/pms/index.js:3869` |
| `financial_manual_entries` | `routes/pms/financialSystem.js:1175, 2386`, `routes/pms/pettyCashAccounts.js:104` |
| `owner_payout_requests` | `routes/pms/ownerPortal.js:601`, `routes/pms/financialSystem.js:884` |
| `vendor_invoices` | `routes/pms/financialSystem.js:3371` |
| `staff_salary_deductions` | `routes/pms/hr.js:516, 680, 1693`, `lib/clockAutoOut.js:119`, `lib/hrPayrollRules.js:463` |
| `staff_payroll_entries` | `routes/pms/hr.js:1423` |
| `cash_ledger` | `routes/pms/index.js:4055, 4179` only |
| `commissions` | **nothing** — table from migration 002 is unused; commissions are computed |

## 4. Findings

### 4.1 Ledger integrity

| # | Finding | Evidence | Severity |
|---|---|---|---|
| L1 | GL is computed, not stored. No journal numbers, posting dates, posted-by, or immutable history for open months. | `ledgerEngine.js:1414 buildJournal` [V] | High |
| L2 | Open-month records can be deleted or edited in place (manual journals, expenses, petty cash, payments). Closed months are protected by freeze + `assertPeriodOpen` (31 call sites), so the damage is limited to open months, but there is no reversal entry, only `audit_log`. | `financialSystem.js:1412, 2401, 2792`, `index.js:3292`; 11 `UPDATE payments/expenses` sites [V] | High |
| L3 | Commission rates are read live: owner/company split from `units.company_commission_pct`, sales commission from the salesperson's current `staff_users.sales_commission_pct`. Changing a rate rewrites every open month. | `lib/commission.js:172`, `ledgerEngine.js:1026, 190` [V] | High |
| L4 | 20 `catch (_)` blocks in the engine turn a failed query (e.g. petty cash, housekeeping orders) into "no rows", silently understating the books. | `ledgerEngine.js` (20 occurrences) [V] | Medium |
| L5 | Balance is guaranteed by construction in builders, but there is no single posting gate that rejects an unbalanced entry. | builders return lines directly [V] | Medium |
| L6 | `booksReset.afterReset()` interpolates a timestamp into SQL text. The value comes from the database and is re-serialised by `Date`, so it is not injectable today, but it is a sharp edge. | `lib/finance/booksReset.js` [V] | Low |

### 4.2 Accounting treatment

| # | Finding | Evidence | Severity |
|---|---|---|---|
| T1 | **Gross vs net is inconsistent.** Bookings credit the owner's slice to revenue (404000) and expense it back (506000 → 202000), which is principal (gross) presentation, while output VAT is charged only on commission + cleaning, which matches agent (net) treatment, and account 401000 is labelled "Agent Split". The correct treatment depends on the owner contracts (control, pricing, inventory risk — IFRS 15 B34–B38 / EAS 48). Needs an accountant decision. | `ledgerEngine.js:208–262`, `taxEngine.js` [V] | High |
| T2 | Salaries are expensed at **net** pay (after deductions) via generated `expenses` rows; gross salary, deductions and employee payables are not separated. | `jobs/monthlySalaryExpenses.js:96` [V] | Medium |
| T3 | Tax rates (VAT 14%, WHT 3%/1%) are constants with no effective dates. | `taxEngine.js:2–4` [V] | Medium |
| T4 | Revenue is deferred by nights (210000/111000) — consistent with recognising accommodation over the stay. | `ledgerEngine.js:774` [V] | OK |
| T5 | Guest insurance is held as a liability (204000), not revenue, until settled; retention goes to 410000. | `ledgerEngine.js:366–449` [V] | OK |
| T6 | Expected credit loss allowance (105900) and write-offs exist. | `ledgerEngine.js:912–954` [V] | OK |

### 4.3 Money and currency

| # | Finding | Evidence | Severity |
|---|---|---|---|
| M1 | Database money is `numeric(14,2)` after migration 139 [V]. Guest-booking side still uses whole-pound `integer` (`bookings.total_egp`, `units.*_egp`) and Paymob uses `amount_cents integer` [V]. The conversion is implicit. | `001_guest_schema.sql:53–262`, `139_…sql:66–90` | Medium |
| M2 | JavaScript arithmetic uses `Number` + `round2()` everywhere (11 finance files). No decimal library in `Server/package.json`. Rounding happens per step, so totals can drift by cents. | `lib/commission.js:6`, `taxEngine.js` [V] | Medium |
| M3 | USD: reservations carry `currency` + `exchange_rate`; the books are in EGP with a USD memo on cash lines (account 104000 "Cash - USD (booked in EGP)"). There is no revaluation or realised FX gain/loss. | `ledgerEngine.js:90–110` [V] | Medium |
| M4 | Percentage columns (`company_commission_pct`, `sales_commission_pct`, …) remain `real`. | migrations 002/003 [V] | Low |
| M5 | `routes/pms/index.js:4162` sums `cash_ledger.amount` and casts to `real`. | [V] | Low |

### 4.4 Duplicate sources of truth

| # | Finding | Evidence |
|---|---|---|
| D1 | `cash_ledger` is written when petty cash moves to expenses and by a manual endpoint, and read by two summary endpoints; the ledger engine never reads it. It disagrees with the GL by design. | `index.js:4055, 4162, 4179`, `compat.js:622, 1446` [V] |
| D2 | `commissions` table (migration 002) is unused; the `Commissions.jsx` page computes from reservations. | [V] |
| D3 | Petty cash moved to expenses is excluded from the engine (`status <> 'moved'`), so it is not double counted in the GL [V]; but `cash_ledger` also records it. | `ledgerEngine.js:1183` |

### 4.5 Payments

- Paymob webhook: HMAC verified (`config/paymob.js:113`, fails closed), amount must equal the session's `amount_cents`, `card_checkout_sessions` row locked `FOR UPDATE`, already-paid sessions return `duplicate: true` [V].
- `payments.idempotency_key` unique index and `(payment_method, transaction_reference)` unique index (skipped if duplicates existed at migration time — **check on live DB [A]**) [V].
- `payments.kind`: collection / refund / forfeit [V].
- Gaps: no gateway settlement import (Paymob payouts vs clearing account 106000 are reconciled by hand on the Reconcile tool), no chargeback handling.

### 4.6 Security and controls [V]

- 84/84 finance routes have `requireRoles`; 81 allow `admin`, `finance`, `finance_manager` identically — **no segregation of duties** (the same person can record, approve, post, close).
- Page access is two-level (`read`/`write`) per page (`lib/pageAccess.js:40`).
- Period reopen requires a reason (`periodLock.js:15`).
- No row-level security is used: the server connects with a direct Postgres pool (`config/db.js`), so RLS would not apply to server queries anyway.
- Audit: `audit_log` via `lib/audit.js` on many actions; not every finance write is audited (to enumerate in Phase 2).

### 4.7 Integrations not yet in the books

| Area | Status |
|---|---|
| Payroll | Net salary as expense only; deductions, loans/advances, bonuses not posted as liabilities/receivables. |
| Commissions (sales) | Accrued (609000/209000) from current % — not snapshotted, no approval/payment lifecycle. |
| Channel manager | Framework exists (`lib/channelManager/reservationImport.js`); imports become reservations, so they reach the books. No live connection. |
| Tasks / maintenance | `housekeeping_service_orders` read by engine; general task costs flow only through expenses. |
| Sales / acquisition | Broker payable (208000) from reservations; acquisition contracts (migration 026) not in the books. |

## 5. Missing capabilities vs the brief

Stored journals with numbers and immutability · reversal/replacement workflow · posting gate · segregated permissions (record vs approve vs post vs close) · snapshotted commission rates · decimal arithmetic · FX revaluation and realised gains · configurable tax with effective dates · gateway settlement import · payroll liabilities · formal month-end checklist evidence · statement of changes in equity · notes to the statements · e-receipt/e-invoice integration (ETA).

## 6. Data checks to run on the live database (before any migration) [A]

1. Rows per finance table since `FINANCE_BOOKS_START`; nulls/negatives/very large amounts in `payments.amount`, `expenses.amount`, `reservations.total_amount`.
2. Reservations with `currency = 'USD'` and missing/zero `exchange_rate`.
3. Duplicate `(payment_method, transaction_reference)` groups (decides whether the unique index exists).
4. `cash_ledger` totals vs GL cash accounts for the same period.
5. Units whose `company_commission_pct` changed after their reservations (needs `audit_log` history).
6. Frozen months in `financial_posted_entries`: trial balance per frozen month must net to zero.

These need a read-only SQL session run by an authorised person, or a temporary admin-only diagnostics endpoint.

## 7. Recommendation (detail in ACCOUNTING_ARCHITECTURE.md)

Evolve, don't replace: keep `ledgerEngine` builders as the **posting rules**, and add a stored, immutable `journal_entries`/`journal_lines` ledger behind a single posting service. Operational changes then post entries (and reversals) instead of being re-derived. This keeps every existing screen working while making the GL the source of truth. Settle the principal/agent policy (T1) **before** posting historical data, because it changes reported revenue for every booking.
