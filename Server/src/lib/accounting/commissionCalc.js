/**
 * Commission split from a reservation's commission snapshot (decision D-12): the rates saved when the
 * reservation was confirmed (migration 175), never the unit's or salesperson's current rate.
 *
 * Same steps as lib/commission.js calcReservationFinancials, which stays the reference:
 *   tenant deduction  = tenant_deduction_pct % × owner gross
 *   commission base   = owner gross − tenant deduction
 *   company           = company_pct % × commission base
 *   owner             = commission base − company
 *   salesperson       = sales_pct % × company
 * `ownerGross` is the rental base less utilities and broker (amounts from the reservation, not rates).
 * Each amount is rounded half-up to the currency's decimals, as the reference rounds each step.
 */
const m = require('./money');

function noSnapshot(msg) {
  return Object.assign(new Error(msg || 'No commission snapshot: this reservation needs a manual rate review'), { code: 'NO_SNAPSHOT' });
}

/** The applied rates from a snapshot row value (jsonb object, or its JSON text). */
function appliedRates(snapshot) {
  const s = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
  if (!s || !s.applied || s.applied.company_pct == null) throw noSnapshot();
  return {
    company: String(s.applied.company_pct),
    tenant: String(s.applied.tenant_deduction_pct ?? 0),
    sales: s.applied.sales_pct == null ? null : String(s.applied.sales_pct),
  };
}

function splitFromSnapshot(ownerGross, snapshot, currency = 'EGP') {
  const rates = appliedRates(snapshot);
  const gross = m.round(m.max(ownerGross, 0), currency);
  const tenant = m.isPositive(rates.tenant) ? m.percentOf(gross, rates.tenant, currency) : m.money(0);
  const base = gross.minus(tenant);
  const company = m.isPositive(rates.company) ? m.percentOf(base, rates.company, currency) : m.money(0);
  const owner = base.minus(company);
  const agent = rates.sales != null && m.isPositive(rates.sales) ? m.percentOf(company, rates.sales, currency) : m.money(0);
  return { ownerGross: gross, tenant, base, company, owner, agent, rates };
}

module.exports = { splitFromSnapshot, appliedRates };
