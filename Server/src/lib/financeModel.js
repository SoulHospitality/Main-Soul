/**
 * Company P&L rules (Soul finance diagram).
 *
 * Revenue = reservation accommodation + housekeeping collected + utilities collected
 * Auto expenses = owner share + salaries + agent % of company commission
 *   - agent % comes from the reservation agent's staff profile (sales_commission_pct)
 * Manual expenses = actual HK + actual utilities + petty cash outs
 * Gross profit = revenue − expenses
 * Tax = 14% of gross profit
 * Net profit = gross − tax
 */

const TAX_PCT = 14;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * @param {number} companyCommission
 * @param {number} agentPct  staff_users.sales_commission_pct for the reservation agent
 */
function agentCommissionFromCompany(companyCommission, agentPct) {
  const base = Math.max(0, Number(companyCommission) || 0);
  const pct = Math.max(0, Number(agentPct) || 0);
  return {
    agentPct: pct,
    agentAmount: round2((base * pct) / 100),
  };
}

/** @deprecated use agentCommissionFromCompany — kept for older call sites */
function autoCommissionsFromCompany(companyCommission, _isWebsite, agentPct = 0) {
  const result = agentCommissionFromCompany(companyCommission, agentPct);
  return {
    ...result,
    makerPct: 0,
    makerAmount: 0,
  };
}

module.exports = {
  TAX_PCT,
  round2,
  agentCommissionFromCompany,
  autoCommissionsFromCompany,
};
