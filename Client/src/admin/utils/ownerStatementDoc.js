import { currency, formatDate, formatDateTime } from './formatters';
import { brandDocument, esc } from './brandDocument';

const money = (v) => esc(currency(v));

/**
 * The owner statement as a branded document. `internal` adds the staff-only deduction breakdown.
 * data = /reports/owner-statement response; period = { from, to }.
 */
export function buildOwnerStatementHtml(data, { from, to, internal = false, actions = true } = {}) {
  if (!data) return '';
  const s = data.summary || {};
  const unit = data.unit || {};
  const reservations = data.reservations || [];
  const expenses = data.expenses || [];
  const ownerExpenses = expenses.filter((e) => e.paid_by === 'owner');
  const ownerExpTotal = ownerExpenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const companyExpTotal = expenses.filter((e) => e.paid_by !== 'owner').reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
  const nights = reservations.reduce((sum, r) => sum + (Number(r.nights) || 0), 0);
  const period = `${formatDate(from)} → ${to ? formatDate(to) : 'today'}`;
  const finalDue = Number(s.finalDue) || 0;

  const resRows = reservations.length
    ? reservations
      .map((r) => {
        const commission = parseFloat(r.company_commission_amount) || 0;
        const pct = parseFloat(r.applied_commission_pct) || 0;
        return `<tr>
          <td>${esc(formatDate(r.check_in))} → ${esc(formatDate(r.check_out))}<br/><span class="k">#${esc(r.id)}${r.guest_name && internal ? ` · ${esc(r.guest_name)}` : ''}</span></td>
          <td class="center">${esc(r.nights)}</td>
          <td class="num">${money(parseFloat(r.intermediate_price_per_night) || 0)}</td>
          <td class="num">${money(parseFloat(r.subtotal) || 0)}</td>
          <td class="num ${commission > 0 ? 'neg' : ''}">${commission > 0 ? `− ${money(commission)}${pct ? ` <span class="k">(${esc(pct)}%)</span>` : ''}` : '—'}</td>
          <td class="num"><b>${money(parseFloat(r.adjusted_total) || 0)}</b></td>
          <td class="center">${r.is_owner_reservation ? '<span class="pill owner">Owner stay</span>' : '<span class="pill ok">Guest</span>'}</td>
        </tr>`;
      })
      .join('')
    : `<tr><td colspan="7" class="muted">No stays in this period</td></tr>`;

  const shownExpenses = internal ? expenses : ownerExpenses;
  const expRows = shownExpenses.length
    ? shownExpenses
      .map((e) => `<tr>
          <td>${esc(formatDate(e.expense_date))}</td>
          <td>${esc(e.description || '—')}</td>
          ${internal ? `<td class="center"><span class="pill ${e.paid_by === 'owner' ? 'owner' : ''}">${e.paid_by === 'owner' ? 'Owner' : 'Company'}</span></td>` : ''}
          <td class="num">${money(e.amount)}</td>
        </tr>`)
      .join('')
    : `<tr><td colspan="${internal ? 4 : 3}" class="muted">No expenses in this period</td></tr>`;

  const breakdown = internal
    ? `<h2>Deduction breakdown (internal)</h2>
      <div class="sum" style="max-width:none">
        <div class="row"><span>Gross revenue (guest payments)</span><span>${money(s.totalGross)}</span></div>
        ${s.totalUtilitiesDeduction > 0 ? `<div class="row"><span>Utilities</span><span class="neg">− ${money(s.totalUtilitiesDeduction)}</span></div>` : ''}
        ${s.totalBrokerDeduction > 0 ? `<div class="row"><span>Broker</span><span class="neg">− ${money(s.totalBrokerDeduction)}</span></div>` : ''}
        ${s.totalTenantDeduction > 0 ? `<div class="row"><span>Tenant commission${s.tenantCommissionPct ? ` (${esc(s.tenantCommissionPct)}%)` : ''}</span><span class="neg">− ${money(s.totalTenantDeduction)}</span></div>` : ''}
        <div class="row rule"><span>Revenue for commission</span><span>${money(s.totalSubtotal)}</span></div>
        ${s.totalCompanyCommission > 0 ? `<div class="row"><span>Company commission${s.commissionLabel ? ` (${esc(s.commissionLabel)})` : ''}</span><span class="neg">− ${money(s.totalCompanyCommission)}</span></div>` : ''}
        <div class="row rule"><span>Owner net</span><span class="pos">${money(s.totalOwnerNet)}</span></div>
        ${companyExpTotal > 0 ? `<div class="row"><span>Company expenses (not charged to the owner)</span><span>${money(companyExpTotal)}</span></div>` : ''}
      </div>`
    : '';

  const body = `
    <div class="parties">
      <div><div class="k">Owner</div><div class="v">${esc(unit.owner_name || '—')}</div></div>
      <div><div class="k">Unit</div><div class="v">${esc(unit.name || '—')}</div></div>
      <div><div class="k">Project</div><div class="v">${esc(unit.project || '—')}</div></div>
      <div><div class="k">Period</div><div class="v">${esc(period)}</div></div>
    </div>

    <div class="tiles">
      <div class="tile"><div class="k">Stays</div><div class="v">${reservations.length} · ${nights} nights</div></div>
      <div class="tile"><div class="k">Revenue</div><div class="v">${money(s.totalSubtotal)}</div></div>
      <div class="tile"><div class="k">Commission</div><div class="v neg">− ${money(s.totalCompanyCommission || 0)}</div></div>
      <div class="tile"><div class="k">Owner expenses</div><div class="v neg">− ${money(ownerExpTotal)}</div></div>
      <div class="tile hero"><div class="k">${finalDue >= 0 ? 'Due to owner' : 'Owner owes'}</div><div class="v">${money(Math.abs(finalDue))}</div></div>
    </div>

    <h2>Stays</h2>
    <table>
      <thead><tr><th>Dates</th><th class="center">Nights</th><th class="num">Per night</th><th class="num">Revenue</th><th class="num">Commission</th><th class="num">Owner net</th><th class="center">Type</th></tr></thead>
      <tbody>${resRows}</tbody>
    </table>

    <h2>${internal ? 'Expenses' : 'Expenses charged to the owner'}</h2>
    <table>
      <thead><tr><th>Date</th><th>Description</th>${internal ? '<th class="center">Paid by</th>' : ''}<th class="num">Amount</th></tr></thead>
      <tbody>${expRows}</tbody>
    </table>

    <div class="sum">
      <div class="row"><span>Revenue</span><span>${money(s.totalSubtotal)}</span></div>
      ${s.totalCompanyCommission > 0 ? `<div class="row"><span>Company commission</span><span class="neg">− ${money(s.totalCompanyCommission)}</span></div>` : ''}
      <div class="row rule"><span>Owner net revenue</span><span>${money(s.totalOwnerNet)}</span></div>
      ${ownerExpTotal > 0 ? `<div class="row"><span>Owner expenses</span><span class="neg">− ${money(ownerExpTotal)}</span></div>` : ''}
      <div class="row grand"><span>${finalDue >= 0 ? 'Final amount due to owner' : 'Amount the owner owes'}</span><span>${money(Math.abs(finalDue))}</span></div>
    </div>
    ${breakdown}
    <p class="note">Revenue is what guests paid for the stays above, after utilities, broker and guest-side commission. Questions about this statement: owners@soulhospitality.co</p>`;

  return brandDocument({
    title: 'Owner statement',
    subtitle: `${unit.name || 'Unit'}${unit.project ? ` · ${unit.project}` : ''}`,
    docTitle: `Owner statement · ${unit.name || ''} · ${period}`,
    metaHtml: `<strong>${esc(period)}</strong>Issued ${esc(formatDateTime(new Date().toISOString()))}`,
    bodyHtml: body,
    footLeft: 'Soul Hospitality · soulhospitality.co',
    footRight: internal ? 'Internal copy' : 'Owner copy',
    actions,
  });
}
