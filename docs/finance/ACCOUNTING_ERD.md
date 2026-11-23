# Accounting ERD (target, new tables only)

```mermaid
erDiagram
  accounts ||--o{ accounts : "parent"
  accounts ||--o{ journal_lines : "posted to"
  journal_entries ||--|{ journal_lines : "has"
  journal_entries ||--o| journal_entries : "reverses"
  accounting_periods ||--o{ journal_entries : "contains"
  financial_events ||--o| journal_entries : "posted as"
  fx_rates }o--|| currencies : "for"
  tax_rates ||--o{ journal_lines : "applied"
  accounting_policies ||--o{ journal_entries : "policy version"

  accounts {
    text code PK
    text name
    text type "asset|liability|equity|revenue|cost_of_revenue|expense"
    text subtype
    text parent_code FK
    text normal_balance "debit|credit"
    char3 currency "null = any"
    bool is_system
    bool active
  }
  journal_entries {
    bigint id PK
    text number UK "JE-2026-000123"
    date transaction_date
    date posting_date
    text period "YYYY-MM"
    text description
    text source_module
    text source_type
    text source_id
    int source_version
    text origin "system|manual|migrated|adjustment"
    text status "posted|reversed"
    bigint reverses_id FK
    bigint reversed_by_id FK
    text idempotency_key UK
    text policy_version
    int created_by
    int approved_by
    timestamptz created_at
  }
  journal_lines {
    bigint id PK
    bigint entry_id FK
    text account_code FK
    numeric debit "19,4"
    numeric credit "19,4"
    char3 currency
    numeric fx_rate "18,8"
    numeric base_debit "19,4"
    numeric base_credit "19,4"
    text memo
    uuid unit_id
    text project
    int reservation_id
    int owner_id
    int employee_id
    int vendor_id
    text tax_code
  }
  accounting_periods {
    text period PK "YYYY-MM"
    text status "open|closing|closed"
    int closed_by
    timestamptz closed_at
    text reopen_reason
  }
  financial_events {
    bigint id PK
    text event_type
    text source_type
    text source_id
    int source_version
    jsonb payload
    text idempotency_key UK
    text status "pending|posted|failed|skipped"
    text error
    bigint journal_entry_id FK
  }
  fx_rates {
    date rate_date
    char3 from_ccy
    char3 to_ccy
    numeric rate
    text source
  }
  tax_rates {
    text code PK
    numeric rate_pct
    date effective_from
    date effective_to
    text account_code
  }
  accounting_policies {
    text version PK
    date effective_from
    jsonb settings "principal_agent per unit, revenue timing, fx, payroll"
    int approved_by
  }
```

Existing tables keep their role as **sources** (reservations, payments, expenses, petty_cash, vendor_invoices, owner_payout_requests, staff_payroll_entries, …). Two columns are added to reservations in Phase 2: `company_commission_pct_snapshot`, `agent_commission_pct_snapshot` (decision D-12).
