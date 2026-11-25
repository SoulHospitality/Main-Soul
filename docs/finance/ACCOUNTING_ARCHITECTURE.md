# Target Accounting Architecture

**Principle:** evolve the existing engine into a stored, immutable ledger. Keep the existing posting logic (the entry builders in `ledgerEngine.js`) as the rules; change *when* they run and *where* the result lives. No second backend, no second database.

## 1. Flow

```
Operational write (reservation, payment, expense, petty cash, payout, vendor bill, payroll, …)
   │  same DB transaction
   ▼
financial_events (outbox)  ── source_module, source_type, source_id, event_type, payload, idempotency_key
   │  posting worker (in-process, every few seconds + on demand)
   ▼
postingService.post(event)
   ├─ accountingRules[event_type](event, policy version)  → proposed lines   (reuses ledgerEngine builders)
   ├─ validate: balanced (Decimal), accounts active, period open, dimensions present
   ├─ diff against what this source already posted  → post only the difference
   │    (new source = full entry; changed source = reversal of old + replacement)
   └─ INSERT journal_entries + journal_lines (immutable; status 'posted')
   ▼
general ledger (journal_lines)  →  balances, statements, subledgers, reports
```

Why diff-and-reverse: today the books are re-derived, so an edited reservation silently changes history. With the posting service, the same edit produces a **reversal of the old entry + a replacement entry**, both visible, both dated, numbered and attributed. Closed periods stay untouched; corrections land in the first open period (as `periodFreeze` already does).

## 2. Modules (`Server/src/lib/accounting/`, following the repo's `lib/` convention)

| Module | Responsibility |
|---|---|
| `money.js` | Decimal arithmetic (`decimal.js`), rounding policy (half-even to 0.01 per currency), parsing from `numeric` strings. No `Number` math on money. |
| `chart.js` | Accounts table access; replaces the constant in `lib/finance/chartOfAccounts.js` (seeded from it). |
| `rules/` | One file per event family; adapters over the existing builders (`bookingEntry`, `collectionEntry`, `expenseEntries`, …). |
| `events.js` | `recordEvent(client, {...})` called inside the operational transaction (outbox). |
| `posting.js` | The only writer of `journal_entries`/`journal_lines`. Validation, idempotency, reversal, numbering. |
| `periods.js` | Open/close/reopen with reasons; wraps `periodLock`/`periodFreeze`. |
| `fx.js` | Rates by date and source; revaluation entries. |
| `tax.js` | Effective-dated tax rates (replaces constants in `taxEngine.js`). |
| `reports.js` | Trial balance, statements, subledgers read from `journal_lines` (SQL aggregates). |
| `reconcile.js` | GL ↔ subledger checks (payments, petty cash, owners, gateway). |

## 3. Guarantees

- **Balanced:** posting rejects any entry whose base-currency debits ≠ credits (Decimal compare) — plus a deferred DB constraint trigger as a second line of defence.
- **Immutable:** DB trigger blocks `UPDATE`/`DELETE` on posted entries and their lines (only `status` draft→posted and `reversed_by` set once are allowed).
- **Idempotent:** `journal_entries.idempotency_key` unique; events carry `(source_type, source_id, version)`.
- **Periods:** posting into a closed period is refused unless the event is an authorised adjustment.
- **Traceable:** every line carries `source_type/source_id` and dimensions (unit, project, reservation, owner, employee, vendor).

## 4. Compatibility

- Existing endpoints keep their shapes. In Phase 3 the report functions switch from `buildJournal()` to `journal_lines`, one report at a time, each verified against the old output for the same period (parallel run).
- `financial_posted_entries` (frozen months) becomes the opening history: migrated as posted entries with `origin='migrated'`.
- Frontend: no accounting maths moves to React; screens read the new endpoints.

## 5. Phasing

| Phase | Content | Exit test |
|---|---|---|
| 2 Foundation | money.js, accounts/journal/period tables, posting service, immutability triggers, events outbox | invariant tests green |
| 3a Parallel run | post events for new activity; nightly compare ledger vs `buildJournal` per account | zero unexplained differences for one full month |
| 3b Cutover | reports read the stored ledger; commission/tax snapshots; payroll liabilities | statements match parallel run |
| 4 UI | journal register, entry detail with source links, reversal UI, permissions | Playwright flows |
| 5 Reporting & close | statements from GL, checklist with evidence, reconciliations | close a test month end-to-end |
| 6 Hardening | security review, performance, docs | acceptance criteria |
