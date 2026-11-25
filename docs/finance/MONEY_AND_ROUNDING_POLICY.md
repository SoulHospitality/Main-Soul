# Money and Rounding Policy

This policy applies to all new accounting code under `Server/src/lib/accounting/`. The existing engine (`lib/finance/ledgerEngine.js`) is the reference implementation and stays as it is, still using `round2`, until cutover.

## Arithmetic
- All money calculations go through `lib/accounting/money.js`, which wraps decimal.js 10.6.0 (pinned exactly) at 34 significant digits. Do not use `+`, `-`, `*`, `/`, `parseFloat`, or `Number()` on money.
- Values arriving from Postgres `numeric` columns are strings. Pass them straight to `money()`; never convert them to `Number` first.
- `toDisplayNumber()` exists only for JSON sent to the user interface. Its result must never be used in a further calculation.

## Precision
| Thing | Precision |
|---|---|
| EGP, USD, EUR amounts | 2 decimals (piasters / cents), from `CURRENCY_DECIMALS` |
| Ledger storage (`ledger_lines`) | `numeric(19,4)`. Values are always stored already rounded to the currency's decimals; the 4 places are spare room, not extra precision. |
| Rates and percentages (commission %, VAT %, FX) | Kept unrounded during calculation; up to 8 decimals (`RATE_DECIMALS`) when stored |

## Rounding
- **Rule:** round half-up (away from zero) to the currency's decimals, using `ROUND_HALF_UP`.
- **When to round:** only at these accounting boundaries:
  1. a journal line amount, when the line is created;
  2. a tax amount (VAT or WHT), calculated per invoice/line from its unrounded base;
  3. an FX conversion to the base currency (EGP), per line;
  4. each share in a split (company / owner / agent).

  Intermediate results (nightly rate × nights × %) are never rounded.
- **Splits:** a split must add back to the whole. `allocate()` uses the largest-remainder method: every share is rounded down, and the leftover piasters go one at a time to the shares with the largest fractions. Ties go to the earliest share. For example, EGP 100.00 split three ways gives 33.34 / 33.33 / 33.33.
- **Commission split order:** the company share is computed and rounded first, the agent share second, and the owner receives the remainder, so owner + company + agent = base exactly. This is in `commissionCalc.splitFromSnapshot`.
- **Balance:** an entry is posted only if its debits equal its credits exactly, in both transaction currency and base currency. There is no tolerance. FX rounding differences go to an explicit rounding line; they are never absorbed silently.

## Known difference from the current engine
The current `round2(n) = Math.round((n + EPSILON) * 100) / 100` works on binary floating-point numbers, so some exact half-piaster values round down. For example, `round2(2.135)` returns 2.13, while the new rule gives 2.14. The reconciliation does not copy this behaviour. It reports these cases in a separate **rounding** bucket: lines that differ by at most 0.01 per entry because of half-piaster rounding. Each one is listed and explained; none is hidden.

## Tests
`Server/src/lib/accounting/money.test.js` covers arithmetic, half-up rounding, allocation, inclusive and exclusive VAT, commission splits, refunds and FX conversion, balance assertions, and reconciliation buckets. It is part of `npm test`.
