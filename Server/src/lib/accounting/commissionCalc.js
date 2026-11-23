/**
 * Commission maths from a reservation's commission snapshot (decision D-12): the rates saved when the
 * reservation was confirmed, never the unit's or salesperson's current rate.
 *
 * Basis (matches lib/commission.js for the standard case):
 *   company commission = company % × rental base
 *   owner share        = rental base − company commission
 *   sales commission   = salesperson % × company commission
 * Full parity with lib/commission.js (tenant markup, owner-booked stays, broker, utilities) is verified
 * in Phase 3 against the existing engine, which stays the reference.
 */
const m = require('./money');

function splitFromSnapshot(rentalBase, snapshot, currency = 'EGP') {
  if (!snapshot || snapshot.company_commission_pct == null) {
    const err = new Error('No commission snapshot: this reservation needs a manual rate review');
    err.code = 'NO_SNAPSHOT';
    throw err;
  }
  const base = m.round(rentalBase, currency);
  const company = m.percentOf(base, snapshot.company_commission_pct, currency);
  const owner = base.minus(company);
  const agent = snapshot.sales_commission_pct != null && m.isPositive(snapshot.sales_commission_pct)
    ? m.percentOf(company, snapshot.sales_commission_pct, currency)
    : m.money(0);
  return { base, company, owner, agent, rates: { company: snapshot.company_commission_pct, agent: snapshot.sales_commission_pct ?? null } };
}

module.exports = { splitFromSnapshot };
