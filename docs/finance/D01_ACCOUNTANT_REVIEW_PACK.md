# D-01 Review Pack: Gross or Net Revenue for Owner Units

**For:** Soul Hospitality's external accountant
**Decision needed:** For each type of unit contract, does Soul Hospitality report the full stay price as its revenue (gross), or only its own commission and fees (net)?
**What we need back:** A written decision for each contract type. It should name the applicable Egyptian Accounting Standard(s) and state the date it takes effect.

This pack does not recommend an answer. Until the written decision arrives, three things stay blocked:
- migrating historical figures into the new ledger;
- posting to the new ledger;
- switching the financial reports to it.

## 1. How the system records a stay today

When a guest stays in an owner's unit, the system records the whole nightly amount as Soul revenue. This includes the owner's part, which goes to account 404000 *Direct Rental Revenue*. The owner's part is then recorded again as an expense (506000 *Owner Share Expense*) and as an amount owed to the owner (202000).

VAT of 14% is charged only on Soul's commission and the cleaning fee. It is not charged on the owner's part.

The result is a mix: revenue is reported as if Soul were selling the stay itself, while VAT is charged as if Soul were only an agent earning a fee. The accountant should check that whichever treatment is approved is consistent with the VAT position, or tell us that a difference is intended.

## 2. Questions about the contracts

Please answer these for each contract type. Where useful, attach a sample signed contract for each type.

**Who controls the stay**
1. Who sets the nightly price: Soul, the owner, or Soul within limits the owner sets?
2. Can the owner block dates, refuse a guest or use the unit themselves without Soul's agreement?
3. Does Soul rent the unit from the owner first (a master lease or fixed rent) and then rent it to guests in its own name?
4. Who is named as the seller on the booking confirmation and on the invoice or receipt?

**Who carries the risk**

5. If a unit stays empty, does Soul still pay the owner anything, such as a guaranteed minimum or fixed rent?
6. If a guest does not pay, damages the unit or gets a refund, who bears the loss: Soul or the owner?
7. When a discount or promo code is applied, does it reduce the owner's share, Soul's share, or both?
8. When a booking is cancelled and the deposit is kept, how is the forfeited amount split? (This is also decision D-04.)
9. Who is responsible to the guest for the condition of the unit and for complaints?

**How Soul is paid**

10. Is Soul paid a percentage of the nightly rate, a fixed fee, or the difference between what the guest pays and what the owner receives?
11. Does Soul collect the guest's money into its own bank account? Is the owner's part held for the owner (account 202000 "funds held in trust"), or is it Soul's money until it is paid out?
12. Which costs are charged back to the owner (utilities, maintenance, cleaning), and does Soul add a markup?

**Tax**

13. What is the VAT base for each contract type: the full stay price, or only Soul's commission and fees? (This is decision D-11, which depends on D-01.)
14. Do withholding-tax duties on payments to owners change with the treatment?
15. Are any units owned by Soul or by related parties? These may be treated differently. (See decision D-09.)

## 3. Worked example: the same stay under each treatment

**The stay:** 5 nights at EGP 2,000 a night, so EGP 10,000.
- Soul's commission is 20%: EGP 2,000.
- The owner's share is EGP 8,000.
- The cleaning fee is EGP 500.
- VAT is 14%.

The examples show the entry made when the stay is recognised. The guest's later payment is the same under every treatment.

### A: Gross, as the system records it today

VAT is charged on the commission and cleaning: 14% × 2,500 = 350.

| Account | Debit | Credit |
|---|---:|---:|
| 105000 Guest receivable | 10,850 | |
| 404000 Direct rental revenue (owner's part) | | 8,000 |
| 401000 Commission revenue | | 2,000 |
| 402000 Cleaning revenue | | 500 |
| 205000 VAT payable | | 350 |
| 506000 Owner share expense | 8,000 | |
| 202000 Owner payable | | 8,000 |

Revenue is **10,500**, the owner-share expense is 8,000 and profit is **2,500**.

### B: Net (Soul acts as agent)

VAT is charged on the commission and cleaning: 350.

| Account | Debit | Credit |
|---|---:|---:|
| 105000 Guest receivable | 10,850 | |
| 202000 Owner payable | | 8,000 |
| 401000 Commission revenue | | 2,000 |
| 402000 Cleaning revenue | | 500 |
| 205000 VAT payable | | 350 |

Revenue is **2,500**, there is no owner-share expense and profit is **2,500**.

### C: Gross, with VAT on the full stay

This scenario applies only if the accountant confirms that the VAT base is the full stay price. VAT is then 14% × 10,500 = 1,470.

| Account | Debit | Credit |
|---|---:|---:|
| 105000 Guest receivable | 11,970 | |
| 404000 Direct rental revenue | | 8,000 |
| 401000 Commission revenue | | 2,000 |
| 402000 Cleaning revenue | | 500 |
| 205000 VAT payable | | 1,470 |
| 506000 Owner share expense | 8,000 | |
| 202000 Owner payable | | 8,000 |

Revenue is **10,500** and profit is **2,500**. However, the guest is charged 1,120 more VAT. That is a pricing decision and a tax decision as well as an accounting one.

### D: Different treatment for different contract types

For example, units that Soul rents in its own name (master leases) could follow A or C, while managed owner units follow B. Each unit's contract type would decide which entry it gets.

## 4. What changes and what does not

| Item | A (today) | B (net) | C (gross, full VAT) |
|---|---|---|---|
| Revenue reported | Full stay | Commission and fees only | Full stay |
| Gross margin % | Low (about 24% in the example) | High (100% of a smaller revenue) | Low |
| Owner share shown as | Expense (506000) | No expense, only the amount owed (202000) | Expense |
| Profit | Same | Same | Same, if prices stay the same |
| Owner payable, receivables, cash | Same | Same | Receivable is higher by the extra VAT |
| VAT payable | 350 | 350 | 1,470 |
| Deferred figures for nights not yet stayed | 210000 (revenue) and 111000 (owner share) | Owner part sits in the liability; no 111000 | Same as A |
| Revenue-based KPIs and budgets (RevPAR, revenue growth, any revenue-based staff targets) | Current basis | Restated on a lower basis | Current basis |

Refunds, discounts and forfeited deposits follow the same split. Under B, a refund of the owner's part reduces what is owed to the owner and does not touch revenue. Under A and C, it reverses revenue and the owner-share expense.

## 5. How the system will apply the decision

- **One setting, not new code.** The decision is stored as a dated, versioned policy in the new ledger's `ledger_policies` table. For example: `revenue_presentation` = `gross` | `net`, set per contract type and, if needed, per unit, with an `effective_from` date. The posting rules read this policy. Changing it does not require changing the accounting engine.
- **Written approval is required.** A policy cannot be marked *approved* unless it records who approved it, when, and a reference to the written approval. Posting stays switched off until an approved policy exists.
- **History stays traceable.** Every entry records which policy version produced it. If the treatment changes later, only entries dated after the new effective date use the new treatment, and earlier periods are not silently rewritten. If past periods need restating, that is done as dated adjusting entries that the accountant approves separately.
- **Reports can be compared.** The current reports keep running on today's calculation until the switch is approved, so old and new figures can be put side by side.

## 6. Response template

| Contract type | Treatment (gross / net) | VAT base | Standard and paragraph relied on | Effective from | Notes |
|---|---|---|---|---|---|
| Managed owner unit | | | | | |
| Master-leased / fixed-rent unit | | | | | |
| Soul-owned unit | | | | | |
| Other (please describe) | | | | | |

Name of the person approving: ________ Date: ________ Reference or signature: ________
