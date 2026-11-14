import { brandDocument, esc, openDocument } from '../../utils/brandDocument';

export const STATUS = {
  requested: { label: 'Requested', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  approved: { label: 'Approved', tone: 'bg-sky-50 text-sky-800 border-sky-200' },
  paid: { label: 'Paid', tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  rejected: { label: 'Not approved', tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled: { label: 'Cancelled', tone: 'bg-slate-50 text-slate-600 border-slate-200' },
};

export const METHOD_LABEL = { bank_transfer: 'Bank transfer', instapay: 'InstaPay', cash: 'Cash pickup' };

export function egp(n) {
  const v = Number(n) || 0;
  return `EGP ${v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function detailsLine(d) {
  if (!d) return '';
  if (d.summary) return d.summary;
  if (d.method === 'instapay') return `InstaPay · ${d.instapay || ''}`;
  if (d.method === 'cash') return `Cash pickup · ${d.phone || ''}`;
  return [d.bank_name, d.account_name, d.iban || d.account_number].filter(Boolean).join(' · ');
}

const dt = (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' }) : '—');

/** Branded receipt for a paid payout, for the owner's records. */
export function openPayoutReceipt(request, ownerName) {
  const d = request.payout_details || {};
  const html = brandDocument({
    title: 'Payout receipt',
    subtitle: `Request #${request.id}`,
    metaHtml: `<strong>${esc(egp(request.amount))}</strong>Paid ${esc(dt(request.paid_at))}`,
    bodyHtml: `
      <div class="parties">
        <div><div class="k">Owner</div><div class="v">${esc(ownerName || '')}</div></div>
        <div><div class="k">Paid to</div><div class="v">${esc(METHOD_LABEL[request.payout_method] || '')}</div></div>
        <div><div class="k">Account</div><div class="v">${esc(detailsLine(d))}</div></div>
        <div><div class="k">Reference</div><div class="v">${esc(request.payment_reference || '—')}</div></div>
      </div>
      <h2>Timeline</h2>
      <table>
        <tr><td>Requested</td><td class="num">${esc(dt(request.created_at))}</td></tr>
        <tr><td>Approved</td><td class="num">${esc(dt(request.reviewed_at))}</td></tr>
        <tr><td>Paid</td><td class="num">${esc(dt(request.paid_at))}</td></tr>
      </table>
      <div class="sum"><div class="row grand"><span>Amount paid</span><span>${esc(egp(request.amount))}</span></div></div>
      <p class="note">This payout is deducted from your owner balance. Keep this receipt with your owner statements.</p>`,
    footLeft: 'Soul Hospitality',
    footRight: esc(`Issued ${dt(new Date())}`),
    docTitle: `Soul payout receipt #${request.id}`,
  });
  return openDocument(html);
}
