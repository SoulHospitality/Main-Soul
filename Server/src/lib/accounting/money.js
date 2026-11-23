/**
 * Financial arithmetic. Every money calculation in the accounting layer goes through here.
 *
 * Rules (see docs/finance/MONEY_AND_ROUNDING_POLICY.md):
 *  - Amounts are Decimal, built from strings (Postgres `numeric` arrives as a string). A JS number is
 *    accepted only as input and converted through its decimal string; money is never calculated
 *    with Number.
 *  - Working precision is 34 significant digits; nothing is rounded mid-calculation.
 *  - Rounding happens only at accounting boundaries, to the currency's minor unit, ROUND_HALF_UP
 *    (the rule the current books use, so the new ledger reproduces them exactly).
 *  - Stored precision is numeric(19,4); posted journal amounts are rounded to the minor unit.
 *  - Allocations (owner/company splits, multi-month deferrals, tax splits) always sum exactly to the
 *    total: the last cent goes by the largest-remainder rule, never lost or invented.
 */
const Decimal = require('decimal.js').clone({ precision: 34, rounding: 4 /* ROUND_HALF_UP */ });

const CURRENCY_DECIMALS = Object.freeze({ EGP: 2, USD: 2, EUR: 2 });
const STORAGE_DECIMALS = 4;
const RATE_DECIMALS = 8;

function decimalsFor(currency = 'EGP') {
  const d = CURRENCY_DECIMALS[String(currency || 'EGP').toUpperCase()];
  if (d == null) throw new Error(`Unknown currency ${currency}`);
  return d;
}

/** Decimal from a string, Decimal or finite number. null/'' are 0 only when `allowEmpty`. */
function money(value, { allowEmpty = true } = {}) {
  if (value instanceof Decimal) return value;
  if (value == null || value === '') {
    if (allowEmpty) return new Decimal(0);
    throw new Error('Amount is required');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount ${value}`);
    return new Decimal(String(value));
  }
  const text = String(value).trim().replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) throw new Error(`Invalid amount "${value}"`);
  return new Decimal(text);
}

const add = (...values) => values.reduce((s, v) => s.plus(money(v)), new Decimal(0));
const sum = (values = []) => add(...values);
const sub = (a, b) => money(a).minus(money(b));
const mul = (a, b) => money(a).times(money(b));
const div = (a, b) => {
  const d = money(b);
  if (d.isZero()) throw new Error('Division by zero');
  return money(a).div(d);
};
const neg = (a) => money(a).negated();
const abs = (a) => money(a).abs();
const cmp = (a, b) => money(a).cmp(money(b));
const eq = (a, b) => money(a).eq(money(b));
const isZero = (a) => money(a).isZero();
const isPositive = (a) => money(a).gt(0);
const max = (...v) => Decimal.max(...v.map((x) => money(x)));
const min = (...v) => Decimal.min(...v.map((x) => money(x)));

/** Round to the currency's minor unit (an accounting boundary). */
function round(value, currency = 'EGP') {
  return money(value).toDecimalPlaces(decimalsFor(currency), Decimal.ROUND_HALF_UP);
}

/** rate% of base, rounded to the currency (e.g. a commission or a VAT amount). */
function percentOf(base, ratePct, currency = 'EGP') {
  return round(money(base).times(money(ratePct)).div(100), currency);
}

/** Tax on top of a net amount: net × rate. */
function exclusiveTax(net, ratePct, currency = 'EGP') {
  const n = round(net, currency);
  const tax = percentOf(n, ratePct, currency);
  return { net: n, tax, gross: n.plus(tax) };
}

/** Split a tax-inclusive gross into net + tax that add back exactly to the gross. */
function inclusiveTax(gross, ratePct, currency = 'EGP') {
  const g = round(gross, currency);
  const tax = round(g.times(money(ratePct)).div(money(ratePct).plus(100)), currency);
  return { gross: g, tax, net: g.minus(tax) };
}

/**
 * Split `total` by weights so the parts sum exactly to the rounded total
 * (largest-remainder method; ties go to the earlier part).
 */
function allocate(total, weights, currency = 'EGP') {
  const t = round(total, currency);
  const w = weights.map((x) => money(x));
  const wSum = w.reduce((s, x) => s.plus(x), new Decimal(0));
  if (!w.length) return [];
  if (wSum.isZero()) throw new Error('Allocation weights add up to zero');
  const unit = new Decimal(1).div(new Decimal(10).pow(decimalsFor(currency)));
  const raw = w.map((x) => t.times(x).div(wSum));
  const floored = raw.map((r) => r.toDecimalPlaces(decimalsFor(currency), Decimal.ROUND_DOWN));
  let left = t.minus(floored.reduce((s, x) => s.plus(x), new Decimal(0)));
  const order = raw
    .map((r, i) => ({ i, rem: r.minus(floored[i]) }))
    .sort((a, b) => b.rem.cmp(a.rem) || a.i - b.i);
  const out = [...floored];
  for (const { i } of order) {
    if (left.abs().lt(unit)) break;
    const step = left.isNegative() ? unit.negated() : unit;
    out[i] = out[i].plus(step);
    left = left.minus(step);
  }
  return out;
}

/** Convert at a stated rate; the rate travels with the amount, never "today's rate" implicitly. */
function convert(amount, rate, toCurrency = 'EGP') {
  const r = money(rate);
  if (!r.gt(0)) throw new Error('Exchange rate must be positive');
  return round(money(amount).times(r), toCurrency);
}

/** Lines balance when total debits equal total credits exactly (after rounding each line). */
function balanceOf(lines = [], currency = 'EGP') {
  let debit = new Decimal(0);
  let credit = new Decimal(0);
  for (const l of lines) {
    debit = debit.plus(round(l.debit || 0, currency));
    credit = credit.plus(round(l.credit || 0, currency));
  }
  return { debit, credit, difference: debit.minus(credit), balanced: debit.eq(credit) };
}

function assertBalanced(lines, currency = 'EGP') {
  const b = balanceOf(lines, currency);
  if (!b.balanced) {
    const err = new Error(`Unbalanced entry: debits ${b.debit.toFixed(2)} ≠ credits ${b.credit.toFixed(2)}`);
    err.code = 'UNBALANCED';
    throw err;
  }
  return b;
}

/** String for a numeric(19,4) column. */
const toDb = (value) => money(value).toFixed(STORAGE_DECIMALS);
/** String for display / API, at the currency's minor unit. */
const toFixed = (value, currency = 'EGP') => round(value, currency).toFixed(decimalsFor(currency));
/** Only for charts and other non-accounting display. Never feed the result back into a calculation. */
const toDisplayNumber = (value, currency = 'EGP') => Number(toFixed(value, currency));

module.exports = {
  Decimal,
  CURRENCY_DECIMALS,
  STORAGE_DECIMALS,
  RATE_DECIMALS,
  decimalsFor,
  money,
  add,
  sum,
  sub,
  mul,
  div,
  neg,
  abs,
  cmp,
  eq,
  isZero,
  isPositive,
  max,
  min,
  round,
  percentOf,
  exclusiveTax,
  inclusiveTax,
  allocate,
  convert,
  balanceOf,
  assertBalanced,
  toDb,
  toFixed,
  toDisplayNumber,
};
