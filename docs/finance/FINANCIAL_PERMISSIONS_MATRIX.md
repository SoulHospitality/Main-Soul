# Financial Permissions Matrix (proposed)

Today 81 of 84 finance routes allow `admin`, `finance`, `finance_manager` equally (FINANCIAL_SYSTEM_AUDIT.md §4.6). Proposed capabilities, enforced server-side; the CEO assigns them per person on top of role defaults.

| Capability | finance (accountant) | finance_manager | admin (CEO) | reservations_manager | owner (portal) |
|---|---|---|---|---|---|
| View ledger, statements, reports | ✓ | ✓ | ✓ | — | — |
| Record payments / expenses / petty cash | ✓ | ✓ | ✓ | payments only | — |
| Approve expenses, refunds, write-offs, payouts | — | ✓ | ✓ | — | — |
| Post manual journals | draft only | ✓ (not own drafts) | ✓ | — | — |
| Reverse a posted entry | — | ✓ + reason | ✓ + reason | — | — |
| Manage chart of accounts / tax rates / policies | — | ✓ | ✓ | — | — |
| Reconcile bank / gateway / petty cash | ✓ | ✓ | ✓ | — | — |
| Close a period | — | ✓ | ✓ | — | — |
| Reopen a period | — | — | ✓ + reason, second approver | — | — |
| Export reports | ✓ | ✓ | ✓ | — | own statement |
| View owner statements | ✓ | ✓ | ✓ | — | **own units only** |
| View salaries / payroll | — | ✓ | ✓ | — | — |

**Separation rules:** the person who drafts a manual journal or requests a payout cannot approve it; reopening a closed period needs a second admin/finance_manager approval; every action records the authenticated actor in `audit_log` and on the journal entry. To decide: D-14.
