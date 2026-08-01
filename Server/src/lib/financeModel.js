/**
 * Company P&L rules (Soul finance diagram).
 *
 * Revenue = reservation accommodation + housekeeping collected + utilities collected
 * Auto expenses = owner share + salaries + agent % of company commission
 *   - manual bookings: 1.5% of company commission
 *   - website bookings: agent 1% + website maker 0.5% of company commission
 * Manual expenses = actual HK + actual utilities + petty cash outs
 * Gross profit = revenue − expenses
 * Tax = 14% of gross profit
 * Net profit = gross − tax
 */

const MANUAL_AGENT_PCT = 1.5;
const WEBSITE_AGENT_PCT = 1.0;
const WEBSITE_MAKER_PCT = 0.5;
const TAX_PCT = 14;

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function agentRatesForReservation(isWebsite) {
  if (isWebsite) {
    return {
      agentPct: WEBSITE_AGENT_PCT,
      makerPct: WEBSITE_MAKER_PCT,
    };
  }
  return {
    agentPct: MANUAL_AGENT_PCT,
    makerPct: 0,
  };
}

/** @param {number} companyCommission */
function autoCommissionsFromCompany(companyCommission, isWebsite) {
  const base = Math.max(0, Number(companyCommission) || 0);
  const { agentPct, makerPct } = agentRatesForReservation(isWebsite);
  return {
    agentPct,
    makerPct,
    agentAmount: round2((base * agentPct) / 100),
    makerAmount: round2((base * makerPct) / 100),
  };
}

module.exports = {
  MANUAL_AGENT_PCT,
  WEBSITE_AGENT_PCT,
  WEBSITE_MAKER_PCT,
  TAX_PCT,
  round2,
  agentRatesForReservation,
  autoCommissionsFromCompany,
};
