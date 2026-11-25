# Accountant Decision Tracker

**Updated:** 2026-11-25. **Source of the answers below:** the accountant's answers as **relayed by the owner** on 2026-11-25. Part D was decided by the owner, at the owner's request. **A signed written copy from the accountant is still to be filed.** Its reference is what the two approvers enter when they record the policy; it is never filled in by the system or the developer.

## Gates for posting
| # | Decision | Register | Received | Answer | Entered as verified approval? |
|---|---|---|---|---|---|
| 1 | EAS 48 principal or agent | D-01 | ✅ 2026-11-25 (relayed) | **Gross** revenue | ☐ At go-live, by admin A (`ledger-policy.js approve --purpose d01`) |
| 2 | VAT base | D-11 | ✅ 2026-11-25 (relayed) | **Taxes postponed: VAT 0** from 25/11 while the company negotiates with the tax authority (`vat_base = suspended`) | ☐ At go-live, by admin B (`--purpose vat`) |
| 3 | Historical commission method | D-12 | ✅ 2026-11-25 (relayed) | **Not needed: historical commissions were already paid.** The review list is kept for reference only | n/a (setting `commission_history_decision`) |
| 4 | Opening balances / history | D-15 | ✅ 2026-11-25 (relayed) | **Start counting from 25/11/2026.** No historical import, no opening balances | n/a (books start setting) |

## Questions R-1 to R-8
| Ref | Answer (relayed) | Effect in the system |
|---|---|---|
| R-1 Refunds | Reduce revenue and tax, "like it never happened" | **Changed:** a refund on an earned stay reverses that stay's revenue, VAT and owner share in proportion; any overpayment returns to the guest receivable |
| R-2 VAT on top of quoted price | Taxes postponed | VAT 0 from 25/11 |
| R-3 Output VAT on markups and fees | Taxes postponed | VAT 0 from 25/11 |
| R-4 Input VAT on utilities | Taxes postponed | VAT 0 from 25/11 (bills expensed in full) |
| R-5 Forfeited deposits | The owner always gets accommodation total − utilities − the company % | **Changed:** forfeits are revenue in full (gross); the owner's share (forfeit − company %; no utilities on a cancelled stay) is an expense owed to the owner |
| R-6 Payroll | Leave as it is | Unchanged (net, as paid) |
| R-7 Petty cash top-up without a source | True | Unchanged (miscellaneous revenue) |
| R-8 Fixed monthly charges include 14% input VAT | True | Unchanged rule; it applies when VAT resumes (0 while suspended) |

## Part D (decided by the owner, 2026-11-25; the accountant may revise)
| Topic | Decision |
|---|---|
| D-02 Revenue timing | Over the nights stayed (as today) |
| D-03 Guest advance payments | A liability (203000) until the stay (as today) |
| D-08 Expected credit loss | Aging matrix (as today) |
| D-10 Income and deferred tax | Outside the system; one manual year-end entry |
| D-14 Segregation of duties | CEOs and financial managers approve, switch, close and reopen (migration 179); finance records; an approver can never be the recorder (enforced by the database) |
| D-13 Legacy cash ledger | Retired as read-only history (live check 4: never used) |

## Still open (not blocking go-live)
- ~~Withholding tax~~ **answered 2026-11-25: suspended too** (`wht_suspended_from`); vendors are paid in full from 25/11.
- ~~Bank and cash balances on 25/11~~ **entered 2026-11-25 from the owner's treasury sheets:** ADIB 631,317.71 · CIB 147,732.00 · Cash EGP 4,753.27 · Petty cash Sokhna 424.00 (total 784,226.98, against retained earnings). `deployment/2026-11-25_opening_balances.sql`.
- **Petty Cash (Tatweer), −26,981.00** (no movement since July): not entered. A drawer can't be negative; it is money spent for Tatweer units, so it is a receivable from Tatweer or a payable to whoever funded it. **Owner to say which.**
- ~~Signed copy~~ **not required (owner, 2026-11-25):** the owner and the accountant approve. In the system, CEOs and financial managers approve from their own login, citing "Accountant's approval confirmed by the owner".

## Change log
| Date | Change | By |
|---|---|---|
| 2026-11-25 | Tracker created; nothing received | Developer |
| 2026-11-25 | Answers received (relayed by the owner); Part D decided by the owner; engine updated (VAT suspension, R-1, R-5) | Developer, on the owner's instruction |
| 2026-11-25 | Withholding suspended too; no signed copy needed; approvers = CEOs and financial managers (migration 179), from their own login | Developer, on the owner's instruction |
| 2026-11-25 | Go-live done in the app (policy 2026.11 approved, posting on). Opening treasury balances entered from the owner's sheets | CEOs / financial manager; developer for the balances, on the owner's instruction |
