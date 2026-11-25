# Accountant Review Package

**For:** Soul Hospitality's external accountant.
**What we need:** three written decisions, plus answers to the questions below. Nothing is posted to the new ledger, and no historical figures are imported, until all three decisions are signed. The system enforces this: it refuses to post without an approved policy carrying both signed approvals.

## The three decisions
| # | Decision | Where | Form |
|---|---|---|---|
| 1 | **Revenue presentation:** principal (gross) or agent (net), per contract type, under EAS 48 *Revenue from Contracts with Customers* | `D01_ACCOUNTANT_REVIEW_PACK.md` §2–§7 | Signed table, decision 1 |
| 2 | **VAT base, per contract type.** Approved separately from decision 1; it is not implied by it | `D01_ACCOUNTANT_REVIEW_PACK.md` §2, §7 | Signed table, decision 2 |
| 3 | **Historical commission rates:** how the rate is established for stays confirmed before rates were saved automatically | `DEPLOYMENT_READINESS.md` §7 (proposed method) | Approval of the method, or a different one |

## Questions the system work raised (how the books behave today; not recommendations)
These are D01 pack questions 16–20 and `ACCOUNTING_ENGINE_VALIDATION.md` "Characterised behaviours":
- **R-1, refunds:** a refund puts the amount back on the guest's receivable without reducing revenue or VAT. Is a refund a returned overpayment, or a price reduction that needs a credit note?
- **R-2, VAT on top:** VAT is added on top of the quoted stay price, so a guest who pays exactly the quoted price leaves the VAT owing. Is the quoted price VAT-inclusive?
- **R-3:** tenant markups and service fees (403000) carry no output VAT.
- **R-4 and R-8:** every utility bill and fixed monthly charge is treated as including 14% input VAT.
- **R-5, forfeits:** forfeited deposits go entirely to company revenue. (Decision D-04 covers the owner's share.)
- **R-6, payroll:** salaries post as an expense at the net amount paid; there are no payroll journals or deduction entries. (D-06)
- **R-7, petty cash:** a petty-cash top-up with no recorded source is booked as miscellaneous revenue.

## Report corrections already made (for your awareness)
These existing reports had defects that are fixed on the development branch, not yet deployed. Once deployed, the displayed figures change wherever a month has been closed (`FINANCIAL_REPORT_VALIDATION.md`):
- **P&L over a period with closed months:** the closed months were missing.
- **Balance sheet after a month close:** it did not balance, because current-year earnings were dropped.
- **Month-close entries:** they could drop lines and come out unbalanced when revenue was in debit or an expense in credit. This changes past closed months' retained earnings once deployed.
- **Unknown accounts and query failures:** these are now reported instead of being silently left out.

Before deployment, the developer and the DBA will show you an old-versus-new comparison, month by month, on a copy of the real books (`rehearsal/README.md` §1).

## Other open decisions (not blocking the first deployment)
`ACCOUNTING_DECISIONS_REGISTER.md`:
- D-04: owner share of forfeits;
- D-05: foreign exchange, revaluation and exchange differences;
- D-06: payroll recognition;
- D-07: leases;
- D-08: credit-loss method;
- D-09: related parties;
- D-10: income tax;
- D-13: retiring the legacy cash ledger;
- D-14: segregation of duties (who may record, approve, post, close and reopen). Today approvals are admin-only, with approver and recorder required to be different people.

## What to return
1. The two signed tables from D01 pack §7, each with the person approving, the date and a reference.
2. Approval of the historical commission method, or your alternative.
3. Answers to R-1 to R-8, in writing where they change a treatment.

The approvals are entered into the system as **verified approvals** by two different admins, each recording their own in a separate signed step. The written references are stored with the policy. Nothing is entered on your behalf without your signed document.
