# Financial Reports — Catalogue and Gap Analysis

Legal status is **to be confirmed by the accountant** (EAS / Companies Law / ETA). "Exists" means the system produces it today from the computed ledger.

| Report | Class | Exists today | Source today | Gap |
|---|---|---|---|---|
| Statement of financial position | Statutory (EAS) | ✓ | `balanceSheet()` | Comparatives column; notes |
| Statement of profit or loss | Statutory | ✓ | `pnlFromBalances()` | Presentation per policy D-01 |
| Statement of changes in equity | Statutory | ✗ | — | **Missing** |
| Statement of cash flows | Statutory | ✓ | `cashFlow()` / `buildCashFlowStatement` | Method documentation |
| Notes to the statements | Statutory | ✗ | — | **Missing** (policies, related parties, commitments) |
| Trial balance (unadjusted / adjusted / post-closing) | Standard | Partly (one TB) | `trialBalance()` | Adjusted and post-closing variants |
| General ledger / account activity | Standard | ✓ | `mirrorTransactions()` | Journal numbers once stored |
| Journal register, manual journals, reversals | Control | Partly | manual entries list | Needs stored journal |
| AR summary, aging, customer statement | Standard | ✓ aging / outstanding | `agingFromReservations()` | Customer statement PDF |
| AP summary, aging, supplier statement | Standard | Partly (vendors) | vendor bills | Supplier statement |
| Cash book, bank book, bank reconciliation | Treasury | Partly | reconcile tool, `financial_bank_snapshots` | Statement import |
| Petty cash report | Treasury | ✓ | petty tool | Cash count evidence |
| Paymob settlement reconciliation | Treasury | ✗ | — | **Missing** (settlement import) |
| Cash / liquidity forecast | Management | ✓ | `paymentCalendar.js`, `expenseForecast.js` | — |
| VAT return (output / input) | Tax | ✓ | `vatReturn()` | Rates effective-dated; base per D-11 |
| Withholding tax report | Tax | Partly | 206000 balance | Per-supplier schedule |
| E-invoice / e-receipt export | Tax (if obliged) | ✗ | — | Obligation unconfirmed |
| Owner statements, owner ledger, owner payables | Hospitality | ✓ | `ownerTrustSubledger()`, owner portal | Tie-out to 202000 shown |
| Revenue by unit / project / source / owner | Hospitality | ✓ | report builder | Reads computed ledger |
| Recognised vs collected revenue | Hospitality | Partly | statements | Dedicated report |
| Unit / project profitability | Hospitality | Partly | report builder | Cost allocation rules |
| Occupancy, ADR, RevPAR, ALOS, cancellation rate | KPI (management) | Partly (KPI page) | `lib/kpi.js` | Formula documentation |
| Commission register (by employee / reservation) | Employee | Partly (`Commissions.jsx`) | computed | Snapshotted rates, paid status |
| Payroll register, deductions, advances | Employee | ✓ payroll pages | HR tables | Not in GL as liabilities |
| Audit trail, user financial activity | Control | Partly | `audit_log` | Finance-specific filters |
| Unreconciled items, suspense, failed postings | Control | ✗ | — | Needs event outbox |
| Migration reconciliation | Control | ✗ | — | Part of Phase 2 |

**Priority gaps:** statement of changes in equity, notes, Paymob settlement reconciliation, stored journal register with reversals, failed/unposted events report, payroll liabilities.
