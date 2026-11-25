# Accounting Standards and Policy Research

**Date:** 2026-11-23 · **Status:** research for accountant review. Nothing here is a legal or compliance opinion.

## 1. Which framework applies

| Question | Finding | Confidence / source |
|---|---|---|
| Is IFRS legally required in Egypt? | No. Egypt has not adopted IFRS; companies apply **Egyptian Accounting Standards (EAS)**, which are close to IFRS but not identical. The current EAS set was issued July 2015 and amended in 2019 and 2023. | IFRS Foundation jurisdiction profile — [ifrs.org/egypt](https://www.ifrs.org/use-around-the-world/use-of-ifrs-standards-by-jurisdiction/view-jurisdiction/egypt/), [Egypt profile PDF](https://www.ifrs.org/content/dam/ifrs/publications/jurisdictions/pdf-profiles/egypt-ifrs-profile.pdf) |
| Revenue and leases | FRA lists **EAS 48** (revenue from contracts with customers, the IFRS 15 equivalent) and **EAS 49** (leases, IFRS 16 equivalent) with an implementation guide. | [FRA decisions 2024](https://fra.gov.eg/en/?p=13760728), [FRA financial reporting standards](https://fra.gov.eg/en/?p=13760752) |
| Effective date of EAS 48/49 for Soul | **Not confirmed.** Trade press reports postponements; the decree text must be checked. | Open — accountant to confirm |
| Which entity reports | **Unknown from the code.** Legal entity, registration type, and whether owners' money is held in a separate trust account are not recorded in the system. | Open — management |

**Working assumption for design:** EAS as the reporting framework, with IFRS used as the interpretive reference where EAS mirrors it. The ledger stays framework-neutral (accounts + dimensions); presentation and policies are configurable and versioned so the accountant's decision changes reports, not stored entries.

## 2. Tax (to verify against the law text and the ETA portal)

| Item | Finding | Source |
|---|---|---|
| VAT standard rate | 14% under VAT Law 67 of 2016; some reduced/table rates exist; Law 157 of 2025 changed certain rates. | [ETA — Law 67/2016 (English)](https://eta.gov.eg/sites/default/files/2024-02/Law-english-no.67-2016.pdf.pdf), [PwC tax summaries](https://taxsummaries.pwc.com/egypt/corporate/other-taxes), [EY Nov 2025](https://taxnews.ey.com/news/2025-2316-egypt-introduces-significant-updates-to-vat-provisions) |
| VAT on short-term accommodation / management fees | **Not confirmed.** Whether VAT applies to the full stay or only to Soul's fee depends on the principal/agent decision and the law's tables. | Open — accountant |
| Withholding tax 1% / 3% | Implemented in `taxEngine.js`; rates come from income-tax law, **not verified in this research**. | Open — accountant |
| E-invoice (B2B) / e-receipt (B2C) | ETA is rolling out B2C e-receipts in waves; Resolution 281 of 2025 added taxpayers from 15 Sep 2025. Whether Soul is in a listed wave is not confirmed. | [KPMG Jul 2025](https://kpmg.com/us/en/taxnewsflash/news/2025/07/tnf-egypt-new-taxpayers-required-to-comply-with-mandate-to-issue-electronic-receipts-for-b2c-transactions.html), [Comarch](https://www.comarch.com/trade-and-services/data-management/legal-regulation-changes/egypt-expands-e-receipt-requirements-for-b2c-transactions-from-september-2025/) |

Design consequence: tax rates move to a `tax_rates` table with effective dates; e-receipt/e-invoice export is scoped only after the obligation is confirmed.

## 3. Standards checklist for Soul's business

| Standard (IFRS / EAS equivalent) | Relevance | Current system | Decision needed |
|---|---|---|---|
| IFRS 15 / EAS 48 Revenue | Core. Principal vs agent (B34–B38: control, primary responsibility, inventory risk, pricing discretion); over-time recognition across nights; cancellation fees; discounts. | Gross presentation + nights deferral (see audit T1, T4) | **D-01, D-02** |
| IFRS 9 Financial instruments | Guest receivables impairment (ECL), owner balances. | ECL allowance 105900 exists | D-08 (ECL method) |
| IFRS 16 / EAS 49 Leases | Only if Soul master-leases units (account 404000 "Owned / Master-Leased" exists) or leases its office. | Not modelled | D-07 |
| IAS 21 Foreign currency | USD reservations and USD cash. | EGP only, USD memo | D-05 |
| IAS 37 Provisions | Guest damage claims, refund obligations. | Insurance liability 204000 | — |
| IAS 19 Employee benefits | Salaries, bonuses, end-of-service if applicable. | Net salary expense | D-06 |
| IAS 24 Related parties | Owners who are also managers/shareholders. | Not tracked | D-09 |
| IAS 7 Cash flows | Cash flow statement. | Exists (`cashFlow()`) | method choice (direct/indirect) |
| IAS 1 / IFRS 18 Presentation | IFRS 18 replaces IAS 1 for IFRS reporters from 2027; EAS presentation applies here. | Fixed layout | keep presentation configurable |
| IAS 8 Errors and estimates | Prior-period adjustments. | Implemented via freeze adjustments | — |
| IAS 12 Income tax | Current/deferred tax. | Not modelled | D-10 |

## 4. Principal vs agent — the decision that matters most

For each unit contract, the accountant should answer: does Soul **control** the stay before the guest gets it?

- **Agent (net):** owner keeps ownership and risk; Soul markets, collects and remits. Revenue = Soul's fee + Soul's own services (cleaning, service fee). Owner's slice is a pass-through liability (202000), never revenue.
- **Principal (gross):** Soul has the unit (e.g. master lease), sets prices at its own risk, is primarily responsible to the guest. Revenue = full stay; owner payments are cost.

The system has a per-unit `commission_mode`. Recommendation: make **gross/net a per-unit (per-contract) policy**, default agent, principal only for master-leased units, effective-dated. This touches revenue size, VAT base, and KPIs, so it must be decided before historical posting.

Sources for the IFRS 15 analysis: [IFRS Community — principal vs agent](https://ifrscommunity.com/knowledge-base/principal-vs-agent-revenue-gross-vs-net/), [IASB IFRS 15 post-implementation review, Feb 2024](https://www.ifrs.org/content/dam/ifrs/meetings/2024/february/iasb/ap6b-ifrs-15-pir-principal-vs-agent-considerations.pdf), [IFRIC agenda decision, software reseller 2022](https://www.IFRS.org/content/dam/ifrs/supporting-implementation/agenda-decisions/2022/principal-versus-agent-software-reseller-may-2022.pdf).
