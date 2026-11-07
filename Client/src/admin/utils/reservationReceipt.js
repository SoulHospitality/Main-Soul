import { currency, formatDate, formatDateTime, nightsText, PAYMENT_METHOD_LABELS, unitDisplay } from './formatters';
import { brandDocument, esc, openDocument } from './brandDocument';

function money(value) {
  return esc(currency(value));
}

function buildBillTotals(reservation) {
  const nights = Number(reservation.nights) || 0;
  const pricePerNight = parseFloat(reservation.price_per_night) || 0;
  const accommodation =
    pricePerNight > 0 && nights > 0
      ? Math.round(pricePerNight * nights * 100) / 100
      : 0;
  const storedTotal = parseFloat(reservation.total_amount) || 0;
  const hkFees = parseFloat(reservation.housekeeping_fees) || 0;
  const beachFees = parseFloat(reservation.beach_access_fees) || 0;
  const ins = parseFloat(reservation.insurance) || 0;
  const lineSum = Math.round((accommodation + hkFees + beachFees + ins) * 100) / 100;
  const total =
    accommodation > 0 && Math.abs(storedTotal - accommodation) <= 0.5
      ? lineSum
      : Math.max(storedTotal, lineSum);
  const amountPaid = parseFloat(reservation.amount_paid) || 0;
  const balance =
    reservation.amount_to_pay != null
      ? Math.max(0, parseFloat(reservation.amount_to_pay) || 0)
      : Math.max(0, Math.round((total - amountPaid) * 100) / 100);

  return { nights, pricePerNight, accommodation, storedTotal, hkFees, beachFees, ins, total, amountPaid, balance };
}

function paymentRowsHtml(payments) {
  const list = (Array.isArray(payments) ? payments : []).filter((p) => String(p.status || '').toLowerCase() !== 'rejected');
  if (!list.length) return `<tr><td colspan="4" class="muted">No payments recorded yet</td></tr>`;
  return list
    .map((p) => {
      const method = PAYMENT_METHOD_LABELS?.[p.payment_method] || p.payment_method || p.method || '—';
      const refund = Number(p.amount) < 0 || p.kind === 'refund';
      const approved = p.is_approved || ['successful', 'paid', 'completed', 'approved'].includes(String(p.status || '').toLowerCase());
      return `<tr>
        <td>${esc(formatDate(p.payment_date || p.created_at))}</td>
        <td>${esc(method)}${refund ? ' <span class="pill">Refund</span>' : ''}</td>
        <td class="center"><span class="pill ${approved ? 'ok' : ''}">${approved ? 'Received' : 'Pending'}</span></td>
        <td class="num ${refund ? 'neg' : ''}">${money(p.amount)}</td>
      </tr>`;
    })
    .join('');
}

/** The guest receipt, in the same design as the owner statement. */
export function buildReservationReceiptHtml(reservation, { actions = true } = {}) {
  if (!reservation) return '';
  const bill = buildBillTotals(reservation);
  const unit = unitDisplay(reservation) || reservation.unit_number || reservation.unit_name || '—';
  const project = reservation.project || reservation.compound || '';
  const paidInFull = bill.balance <= 0.009 && bill.total > 0;

  const lines = [
    bill.accommodation > 0 || bill.pricePerNight > 0
      ? `<tr><td>Accommodation${bill.nights ? ` · ${esc(nightsText(bill.nights))}` : ''}${
          bill.pricePerNight > 0 ? ` × ${money(bill.pricePerNight)}` : ''
        }</td><td class="num">${money(bill.accommodation || bill.storedTotal)}</td></tr>`
      : `<tr><td>Stay</td><td class="num">${money(bill.storedTotal)}</td></tr>`,
  ];
  if (bill.hkFees > 0) lines.push(`<tr><td>Housekeeping</td><td class="num">${money(bill.hkFees)}</td></tr>`);
  if (bill.beachFees > 0) lines.push(`<tr><td>Beach access</td><td class="num">${money(bill.beachFees)}</td></tr>`);
  if (bill.ins > 0) lines.push(`<tr><td>Security deposit (refundable)</td><td class="num">${money(bill.ins)}</td></tr>`);

  const body = `
    <div class="parties">
      <div><div class="k">Guest</div><div class="v">${esc(reservation.guest_name || '—')}</div></div>
      <div><div class="k">Phone</div><div class="v">${esc(reservation.guest_phone || '—')}</div></div>
      <div><div class="k">Unit</div><div class="v">${esc(unit)}${project ? ` · ${esc(project)}` : ''}</div></div>
      <div><div class="k">Stay</div><div class="v">${esc(formatDate(reservation.check_in))} → ${esc(formatDate(reservation.check_out))}</div></div>
      <div><div class="k">Nights</div><div class="v">${esc(nightsText(reservation.nights))}</div></div>
      <div><div class="k">Guests</div><div class="v">${esc([reservation.adults ? `${reservation.adults} adults` : '', reservation.children ? `${reservation.children} children` : ''].filter(Boolean).join(', ') || '—')}</div></div>
    </div>

    <div class="tiles">
      <div class="tile"><div class="k">Total</div><div class="v">${money(bill.total)}</div></div>
      <div class="tile"><div class="k">Paid</div><div class="v pos">${money(bill.amountPaid)}</div></div>
      <div class="tile hero"><div class="k">${paidInFull ? 'Status' : 'Balance due'}</div><div class="v">${paidInFull ? 'Paid in full' : money(bill.balance)}</div></div>
    </div>

    <h2>Charges</h2>
    <table>
      <thead><tr><th>Description</th><th class="num">Amount</th></tr></thead>
      <tbody>${lines.join('')}</tbody>
    </table>
    <div class="sum">
      <div class="row"><span>Total</span><span>${money(bill.total)}</span></div>
      <div class="row"><span>Paid</span><span class="pos">− ${money(bill.amountPaid)}</span></div>
      <div class="row grand"><span>${paidInFull ? 'Balance' : 'Balance due'}</span><span>${money(bill.balance)}</span></div>
    </div>

    <h2>Payments</h2>
    <table>
      <thead><tr><th>Date</th><th>Method</th><th class="center">Status</th><th class="num">Amount</th></tr></thead>
      <tbody>${paymentRowsHtml(reservation.payments)}</tbody>
    </table>
    <p class="note">Thank you for staying with Soul Hospitality. Keep this receipt for your records. ${
      bill.ins > 0 ? 'The security deposit is returned after check-out once the unit is inspected.' : ''
    }</p>`;

  return brandDocument({
    title: 'Payment receipt',
    subtitle: `${unit}${project ? ` · ${project}` : ''}`,
    docTitle: `Receipt SH-${reservation.id}`,
    metaHtml: `<strong>Receipt SH-${esc(reservation.id)}</strong>Issued ${esc(formatDateTime(new Date().toISOString()))}<br/>Reservation #${esc(reservation.id)}`,
    bodyHtml: body,
    footLeft: 'Soul Hospitality · soulhospitality.co',
    footRight: `Receipt SH-${esc(reservation.id)}`,
    actions,
  });
}

/** Opens a printable receipt window for finance/admin. Returns false if popup blocked. */
export function openReservationReceipt(reservation) {
  if (!reservation?.id) return false;
  return openDocument(buildReservationReceiptHtml(reservation));
}
