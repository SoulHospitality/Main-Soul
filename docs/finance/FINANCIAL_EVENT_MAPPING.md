# Financial Event Mapping

Current posting logic lives in `Server/src/lib/finance/ledgerEngine.js`; the "Rule today" column names the builder that will become the posting rule. Debit/credit shown under the **current gross treatment**; D-01 may change revenue lines to the net treatment.

| Event | Source (table / code) | Idempotency key | Rule today | Dr / Cr (current) | Gaps |
|---|---|---|---|---|---|
| Reservation confirmed / edited | `reservations` (`routes/pms/index.js`, `compat.js`, chatbot/website bookings) | `reservation:{id}:v{version}` | `bookingEntry` | Dr 105000 AR / Cr 401000, 404000, 402000, 403000, 409000, 204000, 208000, 205000; Dr 506000 / Cr 202000 owner | Rates read live (L3); no version → edits rewrite |
| Night stayed (recognition) | derived from stay dates | `stay:{id}:{YYYY-MM}` | `stayRecognitionEntries` | Dr 210000 / Cr revenue; Dr 506000 / Cr 111000 | — |
| Guest payment (cash/InstaPay/bank/card/Paymob) | `payments` kind=collection | `payment:{id}` (+ existing `payments.idempotency_key`) | `collectionEntry` | Dr 101000/102000/103000/104000/106000 / Cr 105000 or 203000 (advance) | USD original not kept on line |
| Advance → earned | at check-in | `deposit-reclass:{res}` | `depositReclassEntry` | Dr 203000 / Cr 105000 | — |
| Gateway settlement | Paymob payout (manual today) | `gateway-settle:{payment}` | `gatewaySettleEntry` | Dr bank + Dr 504000 fee / Cr 106000 | No settlement import |
| Refund | `payments` kind=refund, `applyCancellation.js` | `payment:{id}` | `collectionEntry` (negative) | Dr 105000/203000 / Cr treasury | — |
| Cancellation forfeit | `applyCancellation.js`, `cancelSettlement.js` | `forfeit:{res}` | `cancelForfeitEntry` | Dr 203000 / Cr revenue | Owner share of forfeit (D-04) |
| Insurance (security deposit) held / refunded / retained | reservations.insurance, `opsCheckins.js` refund | `insurance:{res}:{step}` | `bookingEntry`, `insuranceRefundEntry` | Cr 204000 held; Dr 204000 / Cr treasury refund; Dr 204000 / Cr 410000 retained | — |
| Write-off | `ar_write_offs` approved | `writeoff:{id}` | `writeOffEntry` | Dr 620000 or 105900 / Cr 105000 | — |
| ECL provision | `ar_bad_debt_provisions` | `provision:{period_month}` | `provisionEntries` | Dr 620000 / Cr 105900 | Method (D-08) |
| Expense recorded / paid | `expenses` (`index.js`, salary job) | `expense:{id}:v{n}` | `expenseEntries` | Dr expense (+107000 input VAT) / Cr treasury or 201000; WHT Cr 206000 | Recognition vs payment not separated for direct expenses |
| Vendor bill / payment | `vendor_invoices` | `vendor-bill:{id}`, `vendor-pay:{id}` | `vendorBillEntries` | Dr expense / Cr 201000; Dr 201000 / Cr treasury | — |
| Petty cash in/out/transfer | `petty_cash`, `lib/opsPettyCash.js` | `petty:{id}` | journal from `petty` rows | Dr/Cr 108000 + drawer accounts | Moved rows excluded (OK); `cash_ledger` duplicate (D-13) |
| Owner payout | `owner_payout_requests` paid (`lib/ownerWallet.js markOwnerPayoutPaid`) | `owner-payout:{id}` | journal from payouts | Dr 202000 / Cr treasury | — |
| Owner recoverables (utilities, maintenance) | reservations utilities, expenses paid_by owner | `recoverable:{…}` | `allocateStayCredits`, expenses | Dr 110000 / Cr … | — |
| Sales commission | reservation × agent % | `agent-commission:{res}` | `agentAccrualEntry` | Dr 609000 / Cr 209000 | Live % (D-12); no payment/approval lifecycle |
| Broker commission | reservation broker deduction | in booking entry | `bookingEntry` | Cr 208000 | Payment lifecycle |
| Salary | `jobs/monthlySalaryExpenses.js` → expenses | `salary:{staff}:{YYYY-MM}` | `expenseEntries` | Dr 602000/501000 / Cr treasury (net) | D-06 (gross, deductions, loans) |
| Recurring charges | `financial_recurring_charges` | `recurring:{id}:{YYYY-MM}` | `recurringEntries` | Dr expense / Cr 201000/treasury | — |
| Manual journal | `financial_manual_entries` | `manual:{id}` | manual mapping | any | Deletable today (L2) |
| Month close | `financial_period_closes` | `close:{YYYY-MM}` | `closeMonthEntry` | P&L → 303000 | — |
| Channel manager booking (future) | `lib/channelManager/reservationImport.js` | `channel:{connection}:{external_id}` | as reservation | as reservation + channel commission | Not live |

Non-financial events (ordinary tasks, inspections, chats) post nothing.
