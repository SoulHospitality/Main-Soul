# Financial Report Validation

**Scope:** the reports the Financial System shows today, all built by the computed engine (`Server/src/lib/finance/ledgerEngine.js`: `buildStatements`, `buildPortal`, `ownerTrustSubledger`, `vatReturn`, `cashFlow`, `agingFromReservations`). A second balance-sheet report lives in `lib/finance/reportBuilder.js` (`balanceSheetReport`).
**Status:** synthetic data only. **Production reports are not switched to the stored ledger**; they keep reading the computed engine. Nothing here has been run on production or on a restored copy.

## Evidence and where it lives
| Evidence | State |
|---|---|
| `Server/src/lib/finance/ledgerEngine.regression.test.js` (11 tests, in `npm test`) | **Committed** with the report fixes |
| `docs/finance/rehearsal/local/engine-validation.js` (43 checks on a disposable PGlite database) | Part of the **uncommitted** ledger work; run locally, all pass |
| Stored-ledger parity (engine journal posted through `lib/accounting/engineAdapter.js`) | Part of the **uncommitted** ledger work; pending its own review |

## Report defects fixed in the engine
Each was reproduced on the committed code before fixing, and each has regression tests.

| ID | Report | Defect | Fix |
|---|---|---|---|
| **DEF-PL-01** | Profit and loss (`buildStatements`) | The P&L was built from balances **after** closing entries. Any closed month inside the selected range dropped out. Example: Oct (closed) + Nov showed revenue 500 / expenses 50 instead of 1,500 / 250 | The P&L comes from operating activity, closing entries excluded, so it is the same whether or not a month is closed |
| **DEF-BS-01** | Balance sheet (`buildStatements`) | Current-year earnings (303000) were forced to 0 whenever **any** month was closed. The balance sheet was off by the profit of every month after the last close (example: assets 1,250 vs liabilities + equity 800) | 303000 = the P&L still open after the closes. This matches `reportBuilder.balanceSheetReport`, which already did this |
| **DEF-CLOSE-01** | Month close (`closeMonthEntry`), which feeds every report | A revenue account in net debit, or an expense account in net credit, was written as a negative amount that `makeEntry` silently dropped. The close came out unbalanced (example: Dr 1,000 / Cr 820; trial balance 2,420 vs 2,240) and the account was never zeroed | Opposite-signed balances close on the other side; the closing entry always balances |

### Worked examples (synthetic; before = `f743ac8`, after = this fix)
| Example | Before | After |
|---|---|---|
| Oct closed (revenue 1,000, expense 200), Nov open (revenue 500, expense 50) | P&L 500 / 50. Trial balance 2,750 = 2,750. Balance sheet: assets 1,250 vs L+E **800** | P&L 1,500 / 250. Trial balance 2,750 = 2,750. Balance sheet 1,250 = 1,250 (302000: 800, 303000: 450) |
| Dec close with a −300 credit note on 401000, cleaning 1,000, allowance release −120 on 620000 | Close: 402000 Dr 1,000 / 302000 Cr 820 only. Trial balance **2,420 vs 2,240**; 401000 and 620000 left open | Close: 401000 Cr 300, 402000 Dr 1,000, 620000 Dr 120, 302000 Cr 820 (1,120 = 1,120). Trial balance 2,540 = 2,540; nothing left open |
| Dec closed as above, then Jan open (revenue 400) | Trial balance **2,820 vs 2,640**; balance sheet 1,220 vs **820** | Trial balance 2,940 = 2,940; balance sheet 1,220 = 1,220 (302000: 820, 303000: 400) |

**Accounting check (no double count):** the period's profit equals closed-month retained earnings plus open current-year earnings. In the first example, 1,250 = 800 + 450. This is asserted in the regression tests.

## Report checks
These are from the synthetic engine-validation suite: uncommitted, run locally.

| Report | Check | Result |
|---|---|---|
| Trial balance | Total debits = total credits | ✅ |
| General ledger | Every entry balanced and at 2 decimals | ✅ |
| Profit and loss | Includes closed months in the range; same with or without the close | ✅ after DEF-PL-01 (it failed before) |
| Balance sheet | Assets = liabilities + equity, with and without a closed month | ✅ after DEF-BS-01 (off by 1,966.40 before) |
| Cash flow | Opening + net change = closing = treasury balances; the sections add up | ✅ |
| Accounts receivable | 105000 rebuilt independently (5,073.19) | ✅. ⚠ The aging list uses a different basis (below) |
| Accounts payable | Only the open owner-paid repair (1,200) remains | ✅ |
| Owner balances | Subledger ties to 202000 | ✅ |
| Commission | Booked commission and salesperson payable equal the independent figures | ✅ |
| VAT | Output = sum of stay VAT = 205000; input = 107000 | ✅ (treatment ⚠ D-11) |
| Unit profitability | No dedicated report; revenue per unit rebuilt from the journal | ✅ (reconstruction only) |

## Effect on production once deployed
These engine fixes change what the Financial System **displays**, wherever a month has been closed. The migrations do not change the reports.

- Balance sheet: current-year earnings appear (DEF-BS-01).
- The P&L over a range with closed months grows to include them (DEF-PL-01).
- Retained earnings and closing entries change for any closed month that had an opposite-signed balance (DEF-CLOSE-01).

**Closing entries are not stored.** `buildJournal` regenerates them from each closed month's journal on every request, and frozen copies (`financial_posted_entries`) exclude them (`periodFreeze.liveMonthJournal`). So the DEF-CLOSE-01 fix also changes past closed months, and **live check 6 cannot detect** affected months: it only sums the frozen copies.

To see the effect: on the restored copy, run `rehearsal/compare-books.js` with the old code (`main`) and with the new code against the same database, then compare the closing entries month by month. See `DEPLOYMENT_READINESS.md` for the procedure.

## Known differences by design
- **Aging vs 105000:** the aging list is reservation-based (total minus `amount_paid`); 105000 is journal-based and includes VAT added on top (R-2), refunds put back (R-1) and write-offs. They differ wherever R-1 or R-2 applies.
- **Headline revenue vs P&L revenue:** the portal's gross revenue is total guest receipts; the P&L revenue accounts follow D-01 presentation. Both are shown, unchanged.

## Not yet covered
- Fixtures for insurance, vendor invoices, recurring charges, petty cash, housekeeping orders and holdbacks.
- Line-by-line comparison of exports (`financialExport.js`); the exports use the same `buildStatements` output.
- Contra P&L accounts in the close: none exist today. Under review in the ledger work as L4.
- Manual entries posted directly to 303000: the balance sheet overwrites 303000. Under review as L5.
