# Financial System: Ledger Screens

**Branch:** `feature/finance-ledger` (2026-11-25). Built for the stored ledger (migration 176), commission snapshots (migration 175) and the report-integrity fix (DEF-ACC-01). **Read-only by design:** no screen switches posting on, approves a policy, posts an entry or corrects a snapshot. Those stay in the verified, logged procedures (`db-security/README.md`).

## What was added
| Where (Financial System → Books / Reports) | Shows | API (finance and admin roles) |
|---|---|---|
| **Ledger controls** | Posting switch state and who last changed it; the four go-live gates (revenue presentation, VAT base, historical commission method, verified identity); policy versions with both written approvals and references; stored-ledger totals; ledger months; the permanent control log | `GET /api/pms/financial-system/ledger-controls` |
| **Commission review** | Rate-snapshot counts (saved at confirmation, flagged, before snapshots, corrected); every stay waiting for a commission decision, linked to its timeline; Excel export | `GET /api/pms/financial-system/commission-review` |
| **Financial statements** (warning banner) | Accounts in the books that are missing from the chart, with their debit, credit and number of entries | `integrity` now included in `GET /api/pms/financial-system/reports` (it was dropped before, so DEF-ACC-01 never reached the screen) |

Before migrations 175/176 are applied (production today), both pages say plainly that the feature is not installed yet, instead of failing. The verified-identity gate shows only *configured / not configured / misconfigured*; the key and its id are never sent to the browser.

Everything is in English and Arabic (`pms.fin.ledger`, `pms.fin.commissionReview`, `pms.fin.integrity`), and the layout follows the right-to-left direction in Arabic.

## Files
- Server: `Server/src/routes/pms/financeLedger.js` (new); `routes/pms/index.js` (mount); `routes/pms/financialSystem.js` (`integrity` in reports).
- Client: `Client/src/admin/pages/finance/ledger.jsx` (new); `FinancialSystem.jsx` (two Books entries); `finance/reports.jsx` (banner); `Client/src/i18n/en.json`, `ar.json`.

## Verified (local, synthetic data)
- **`rehearsal/local/ledger-ui-api-test.js`, 21/21:**
  - both schema states (before and after 175/176);
  - other roles get 403;
  - the identity key never appears in a response;
  - draft policies never count as approved;
  - review counts and list;
  - `integrity` present in reports;
  - the endpoints write nothing.
- **`rehearsal/local/ui-e2e.js`:** the real server on a real local PostgreSQL 17.5 (stays seeded before 175/176, then deployed), Vite, and headless Chrome. All three screens, in English and Arabic: no page errors, no untranslated keys, only local connections apart from the server's exchange-rate lookups. Screenshots are in `docs/finance/ui/`.
- **Regression:** `npm test` 154/155 (the known HR test), ledger 139, engine 43 and 23, security 20, Paymob 11, rehearsal 28. The client builds.

## Screenshots
`ui/fin-ledger-en.png`, `ui/fin-ledger-ar.png`, `ui/fin-commission-review-en.png`, `ui/fin-commission-review-ar.png`, `ui/fin-statements-en.png`, `ui/fin-statements-ar.png`.

## Financial statements to the accounting standards (2026-11-25)
**Reports → Financial statements** now presents the statements as EAS 1 / IAS 1 require, with the accountant's decisions applied:
- **Statement of profit or loss, by function:**
  - Revenue (the full stay price over the nights stayed: gross, D-01 / EAS 48);
  - Cost of revenue, including the owner share (506000);
  - Gross profit, operating expenses, operating profit, profit before tax;
  - Income tax (outside the system, D-10);
  - Profit for the period.

  It is built from the posted accounts (`profitOrLossStatement` in `ledgerEngine.js`), so it agrees with the statement of financial position and with the stored ledger. Before this change the page took booking-date reservation totals as revenue and deducted the owner share from revenue (the net, agent presentation). That figure is still shown, labelled *Management figure (not revenue): bookings made in the period*.
- **Statement of financial position, as at the period end:**
  - current and non-current assets and liabilities (by account code: 10–11 and 20–21 are current);
  - equity, with retained earnings including the 25/11 opening balances, and the profit for the period;
  - a check that assets equal equity plus liabilities.
- **Trial balance:**
  - totals and balances (Egyptian practice): debit and credit totals, then each account's debit or credit balance;
  - a check that it balances.
- **Presentation:**
  - every statement shows its title, its period or "as at" date, and the currency (EGP);
  - costs and credit balances appear in parentheses;
  - zero lines are hidden.
- **Excel export** (statements workbook): the same statement layout, with bookings in a separate *Management figures (not revenue)* section.
- **Tested:**
  - engine regression test (gross statement ties to the balance sheet), 17/17;
  - `engine-validation` 45/45, `engine-validation-extra` 23/23, `accountant-decisions-test` 15/15, `ledger-ui-api-test` 21/21;
  - all three tabs rendered in Chrome in English and Arabic with no errors and no missing labels (the test data's deliberate unknown-account line is flagged as "not balanced", as intended).
