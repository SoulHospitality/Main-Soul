# Accounting Engine Validation

**Scope:** the existing computed engine (`Server/src/lib/finance/ledgerEngine.js`, the reference implementation), the commission and snapshot calculations, and `money.js`.
**Method:** synthetic fixtures on a disposable Postgres (PGlite, all 176 migrations applied). Expected figures are computed independently with `money.js` (Decimal), never with floats.
**Evidence:**
- **Committed:** `ledgerEngine.regression.test.js` in `npm test`, 11 of 11.
- **Uncommitted:** `docs/finance/rehearsal/local/engine-validation.js`, 43 of 43. It is part of the ledger work still under review, together with `engineAdapter.js` and the PGlite fixtures.

**Not validated:** production data. Every result here is **local-only**.

## Fixtures (`rehearsal/local/engine-fixtures.js`)
| Stay | Setup | Exercises |
|---|---|---|
| S1 | Mode A, 20%, 4 nights × 1,000, cleaning 500, check-in 30 Oct, paid in advance in cash | Commission, owner share, VAT, salesperson %, deferral across the month end, deposit reclass |
| S2 | Mode B, 25%, tenant 5%, USD stay at 48.5 (stored as EGP equivalent), USD cash | Tenant deduction, USD cash lines |
| S3 | Mode C, owner-booked (owner % 12) | Owner-booked rate |
| S4 | Mode C guest stay, 22%, tenant 10%, Paymob card, partial refund, write-off | Gateway fee, refund, bad debt |
| S5 | Future confirmed stay, paid by InstaPay | Guest deposit liability |
| S6 | Cancelled, unpaid | Nothing booked |
| — | Company utility bill 850, owner-paid repair 1,200, allowance targets 200 → 150, October closed | Input VAT, owner-paid cost, expected credit loss, month close |

## Results by area
| Area | What was checked | Result |
|---|---|---|
| Double entry | All 28 entries balance exactly (Decimal); every amount at 2 decimals; trial balance debits = credits | ✅ |
| Account classification | Statements group by type; balance sheet A = L + E (after the fix below); the stored chart carries normal balances | ✅ |
| Revenue across nights | S1: 2 of 4 nights deferred at check-in to 210000, released 1 Nov; 210000 at 31 Oct = 2,000 | ✅ Cleaning (402000) is recognised in full at check-in, not spread: a policy point, not a defect |
| Deferred and unearned amounts | S5's advance payment sits in 203000 until the stay; S1's deposit reclassed at check-in | ✅ |
| Owner liabilities | Owner share credited to 202000; the owner-paid repair reduces it; the owner subledger ties to 202000 | ✅ |
| Commission and snapshots | Engine split = snapshot calculation (`commissionCalc`) for modes A, B, C and owner-booked; salesperson 10% of company share; 2,000-case random parity (money.test) | ✅ |
| Refunds | Paid out through the gateway and put back on the receivable; revenue unchanged | ✅ as built. ⚠ Accountant question R-1 |
| Cancellations | Cancelled unpaid stay: no entries; forfeits go 100% to company revenue 409000 | ✅ as built. ⚠ D-04 |
| Discounts | Not a separate engine path: a discount is a lower reservation total, so revenue and owner share fall in proportion | Characterised; owner/company split of discounts is a contract question (D01 pack Q7) |
| Chargebacks | Not modelled | ❌ Gap G-3 |
| VAT | Output VAT = 14% × (commission + cleaning), not on owner share or tenant markup; input VAT assumes VAT-inclusive bills at 14% | ✅ as built. ⚠ D-11, hard-coded rates (T3) |
| VAT reversal | No VAT credit note path. A refund does not reverse output VAT | ⚠ R-1, D-11 |
| FX | USD stays store EGP equivalents at the booking rate; USD cash lines carry dollars = EGP ÷ rate; no revaluation, no realised or unrealised FX difference | ✅ as built. ⚠ D-05 (FX differences not recognised) |
| Bad debt | Write-off: Dr 620000 / Cr 105000; allowance moves to each month's target (+200, −50) | ✅ |
| Month close | October profit moved exactly to 302000 | ✅ after fix **DEF-CLOSE-01** |
| Dated corrections | Engine: editing a source recomputes open months silently (L2). Stored ledger: reversal + replacement, closed-period adjustments approved by a different admin | ✅ stored ledger; ⚠ engine L2 by design |
| Rounding and allocation | Splits sum exactly (largest remainder); engine `round2` drifts ≤ 0.01 on half-piaster floats (<5% of random cases, all within 0.01) | ✅ (rounding bucket in reconciliation) |

## Defects found and fixed (regression-tested)
| ID | Defect | Effect before the fix | Fix | Test |
|---|---|---|---|---|
| **DEF-CLOSE-01** | `closeMonthEntry` wrote a revenue account in net debit, or an expense account in net credit, as a negative amount; `makeEntry` then silently dropped that line | The close entry was **unbalanced**, the account was not zeroed, and the wrong profit went to retained earnings. Example: a month whose only bad-debt movement is an allowance release | Opposite-signed balances close on the other side | `ledgerEngine.regression.test.js` (4); engine-validation; reproduced on the committed code |
| **DEF-BS-01** | `buildStatements` forced current-year earnings to 0 whenever **any** month was closed | The **balance sheet did not balance** by the profit of every month after the last close (fixture: 1,966.40) | Current-year earnings = remaining open P&L (closed months are already in 302000) | regression test (3); engine-validation; reproduced on the committed code |
| **DEF-PL-01** | `buildStatements` built the P&L from post-close balances | Any closed month inside the selected range **dropped out of the P&L** (example: 500 / 50 shown instead of 1,500 / 250) | The P&L comes from operating activity, closing entries excluded | regression test (4); reproduced on the committed code |
| L4 (Phase 5B) | The close chose its side from the contra-aware signed balance | A contra P&L account would have closed on the wrong side | Close each P&L account by reversing its raw net | regression test "L4" |
| L5 (Phase 5B) | `balanceSheet` / `reportBuilder.balanceSheetReport` replaced 303000 with the open P&L | A manual posting to 303000 vanished from the balance sheet | 303000 = posted balance + open P&L | regression test "L5" |
| DEF-TEST-01 | Three finance test files (`applyCancellation`, `cancelSettlement`, `paymentInput`, 14 tests) were not in `npm test` | They never ran | Added to the `npm test` script | `npm test` now 134 tests |

**Production impact (what changes when the fixed code is deployed):**
- **DEF-BS-01 and DEF-PL-01** affected every balance sheet and every P&L range viewed after the first month close. Those reports will change.
- **DEF-CLOSE-01:** closing entries are **not stored**. `buildJournal` regenerates them from each closed month's journal on every request, and frozen copies in `financial_posted_entries` exclude them (`periodFreeze.liveMonthJournal`). So the fix also changes the closing entries and retained earnings of **past closed months** that had an opposite-signed balance. **Live check 6 cannot detect these**, because it only sums frozen copies. The way to measure the effect is to run `rehearsal/compare-books.js` with the old code (`main`) and the new code against the same restored copy, and compare the closing entries month by month.

## Characterised behaviours needing an accountant's view (not changed)
- **R-1, refunds:** a refund puts the amount back on the guest receivable without reducing revenue or VAT. It is right for returning an overpayment, but wrong for a price reduction or partial cancellation, which needs a credit note.
- **R-2, VAT on top of the quoted price:** output VAT is added to the guest invoice *on top of* the reservation total. A guest who pays exactly the quoted total leaves the VAT open on the receivable. In the fixture, 182 + 299.25 + 124.74 is still owed. Is the quoted price VAT-inclusive or exclusive? (D-11)
- **R-3, tenant markup and service fees (403000) carry no output VAT.** (D-11)
- **R-4, input VAT:** every utility bill is assumed to include 14% VAT. (T3)
- **R-5, forfeits:** forfeited deposits go entirely to company revenue. (D-04)
- **R-6, payroll:** salaries post as expenses at the net amount; there are no payroll journals or deductions. (D-06)

## Engine robustness notes (not changed; reference implementation)
- `loadPortalData` wraps 20 queries in `catch (_) { rows = [] }` (audit L4). A failing query silently drops a whole category, such as write-offs, from the books. The stored ledger has no equivalent path.
- `makeEntry` filters out non-positive lines and only flags `balanced: false`, with a 0.02 tolerance, instead of refusing the entry. The proposed engine adapter (`lib/accounting/engineAdapter.js`, uncommitted ledger work) refuses or normalises such cases explicitly and reports each one.
