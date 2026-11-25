# Accountant Decision Tracker

**Updated:** 2026-11-25 · **Status of every item below: not received.** No decision has been made, recorded or assumed on anyone's behalf.
This tracker records only what has actually been received in writing. The decisions themselves are in `ACCOUNTING_DECISIONS_REGISTER.md`; the questions are in `ACCOUNTANT_REVIEW_PACKAGE.md` and `D01_ACCOUNTANT_REVIEW_PACK.md`.

## Gates for posting and historical import (all three required)
| # | Decision | Register | Sent? | Received? | Approver | Date | Written reference | Entered as verified approval? |
|---|---|---|---|---|---|---|---|---|
| 1 | EAS 48 principal or agent, per contract type | D-01 | ☐ | ☐ Not received | | | | ☐ |
| 2 | VAT base, per contract type (separate from 1) | D-11 | ☐ | ☐ Not received | | | | ☐ |
| 3 | Historical commission-rate method (`DEPLOYMENT_READINESS.md` §7) | D-12 (method part) | ☐ | ☐ Not received | | | | ☐ |

Until all three rows are complete, posting stays **off** and no historical figures are imported. The database enforces the first two: it will not approve a ledger policy without two verified approvals. The third gates the commission review list and any import.

## Questions raised by the system work (answers change treatments; not gates for the first deployment)
| Ref | Question (short) | Received? | Answer / reference |
|---|---|---|---|
| R-1 | Refunds: returned overpayment, or price reduction needing a credit note? | ☐ | |
| R-2 | Is the quoted stay price VAT-inclusive? | ☐ | |
| R-3 | Output VAT on tenant markups and service fees (403000)? | ☐ | |
| R-4 | Input VAT on utility bills? | ☐ | |
| R-5 | Forfeited deposits: all company revenue? (with D-04) | ☐ | |
| R-6 | Payroll journals: gross with deductions? (with D-06) | ☐ | |
| R-7 | Petty-cash top-ups with no recorded source | ☐ | |
| R-8 | Input VAT on fixed monthly charges | ☐ | |

## Other open register items (not blocking the first deployment)
| Register | Topic | Owner | Status |
|---|---|---|---|
| D-02 | Revenue timing (over nights stayed) | Accountant | Open (confirm) |
| D-03 | Guest advances as a liability until the stay | Accountant | Open (confirm) |
| D-04 | Owner share of forfeits | Management | Open |
| D-05 | Currency, USD revaluation, exchange differences | Accountant | Open |
| D-06 | Payroll recognition | Accountant | Open |
| D-07 | Leases | Management | Open |
| D-08 | Expected credit-loss method | Accountant | Open |
| D-09 | Related parties | Management | Open |
| D-10 | Income tax and deferred tax | Accountant | Open |
| D-13 | Retiring the legacy cash ledger | Management | Open |
| D-14 | Segregation of duties | Management | Open |
| D-15 | Historical data: opening balances or migrated entries | Accountant | Open |

## How a received decision is recorded
1. File the signed document privately (not in this repository). Note only the approver's role, the date and a reference here.
2. Update the register row's status, citing the reference.
3. For decisions 1 and 2: create the policy version with the written treatment. **Two different admins** each record their own verified approval in a separate signed step (`docs/finance/db-security/README.md`), entering the document reference. The system refuses an approval recorded on someone else's behalf.
4. For decision 3: record the approved method, or the accountant's alternative, in `DEPLOYMENT_READINESS.md` §7, then work the commission review list with it.
5. Posting is switched on only after deployment, all three gates, and the owner's separate written instruction.

## Change log
| Date | Change | By |
|---|---|---|
| 2026-11-25 | Tracker created. Nothing received. | Developer |
