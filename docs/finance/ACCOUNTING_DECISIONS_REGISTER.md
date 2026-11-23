# Accounting Decisions Register

Each decision needs an owner, a date and an effective period. The ledger will store which policy version produced each entry, so changing a decision later is a dated policy change, not a rewrite of history.

| ID | Decision | Options | Current system | Recommendation | Owner | Status |
|---|---|---|---|---|---|---|
| D-01 | Principal or agent per unit contract | Agent (net) / Principal (gross) / per unit | Gross for all (owner slice in revenue 404000, then 506000 expense) | **No recommendation.** The accountant decides under the Egyptian Accounting Standards. Questions and scenarios are in D01_ACCOUNTANT_REVIEW_PACK.md. The system stores the treatment as an approved, dated `ledger_policies` version. | Accountant | **Open. Blocks historical migration, posting and report switching until written approval is received.** |
| D-02 | Revenue timing for stays | At booking / over nights stayed / at checkout | Over nights (deferred 210000) | Keep over nights | Accountant | Open (confirm) |
| D-03 | Guest advance payments | Liability "guest deposits" (203000) until stay | 203000 reclassed at stay | Keep | Accountant | Open (confirm) |
| D-04 | Cancellation fees / forfeited deposits | Revenue when forfeited / owner share of forfeit | Forfeit entry exists | Define owner share of forfeits per contract | Management | Open |
| D-05 | Functional and presentation currency, USD handling | EGP functional; USD at transaction-date rate; month-end revaluation of USD cash | EGP + USD memo, no revaluation | EGP functional; record USD originals + rate; revalue USD cash monthly; realised FX on conversion | Accountant | Open |
| D-06 | Payroll recognition | Net salary expense / gross salary + deductions + payables | Net | Gross salary expense, deductions as reductions/recoveries, employee payable until paid, loans as receivables | Accountant | Open |
| D-07 | Leases (master leases, office) | EAS 49 right-of-use / not applicable | Not modelled | Confirm whether any master lease exists | Management | Open |
| D-08 | Expected credit loss method | Aging matrix / specific | Allowance exists | Aging matrix by days overdue | Accountant | Open |
| D-09 | Related parties | Track owners/staff who are related | Not tracked | Flag on owner/staff records | Management | Open |
| D-10 | Corporate income tax and deferred tax | In-system / external | Not modelled | Keep external for now; post year-end tax entry manually | Accountant | Open |
| D-11 | VAT base | Full stay / Soul fee only | Fee + cleaning | Follows D-01 | Accountant | Open |
| D-12 | Commission rates history | Snapshot at booking / live | Live | Snapshot the unit split (company / owner / tenant %) and salesperson %, with the basis and effective date, at confirmation. Rate changes affect future stays only. Corrections must be explicit and logged. Historical stays whose rate cannot be established are flagged for manual review, never backfilled. | Management | **Approved (Phase 2). Built in migration 175.** |
| D-13 | `cash_ledger` | Retire / migrate into GL | Legacy side record | Read-only archive; stop writing; GL cash accounts become the cash record | Management | Open |
| D-14 | Segregation of duties | Who records / approves / posts / closes / reopens | Same 3 roles everywhere | See FINANCIAL_PERMISSIONS_MATRIX.md | Management | Open |
| D-15 | Historical data | Post history from FINANCE_BOOKS_START (2026-10-01) as "migrated" entries / opening balances only | Computed from 2026-10-01 | Opening balances at last closed month + migrated entries for open months | Accountant | Open |
