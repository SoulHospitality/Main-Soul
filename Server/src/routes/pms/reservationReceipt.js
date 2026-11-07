const express = require('express');
const PDFDocument = require('pdfkit');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { STAFF_EDITOR_ROLES } = require('../../lib/staffEditorRoles');
const { sendEmail } = require('../../services/email');

const router = express.Router();

function money(value) {
  return Number(value || 0).toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function loadReceipt(id) {
  const { rows } = await query(
    `SELECT r.*, COALESCE(u.unit_number, u.title) AS unit_label, COALESCE(u.project, u.compound) AS project
     FROM reservations r
     JOIN units u ON u.id = r.unit_id
     WHERE r.id = $1`,
    [id]
  );
  if (!rows[0]) return null;
  const { rows: payments } = await query(
    `SELECT amount, payment_date::text AS payment_date, payment_method, status
     FROM payments
     WHERE reservation_id = $1 AND status <> 'rejected'
     ORDER BY payment_date`,
    [id]
  );
  return { reservation: rows[0], payments };
}

function renderReceipt(res, reservation, payments) {
  // Same look as the owner statement: navy letterhead, summary tiles, ruled tables.
  const NAVY = '#0b2f4a';
  const MUTED = '#64748b';
  const LINE = '#e2e8f0';
  const doc = new PDFDocument({ margin: 0, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width;
  const M = 44;
  const day = (v) => String(v || '').slice(0, 10);
  const nights = Number(reservation.nights) || 0;
  const total = Number(reservation.total_amount || 0);
  const paid = Number(reservation.amount_paid || 0);
  const due = Math.max(0, total - paid);

  doc.rect(0, 0, W, 118).fill(NAVY);
  doc.fillColor('#ffffff').fontSize(9).text('SOUL HOSPITALITY', M, 30, { characterSpacing: 2 });
  doc.fontSize(22).text('Payment receipt', M, 48);
  doc.fontSize(10).fillColor('#cbd5e1').text(`${reservation.unit_label || 'Unit'}${reservation.project ? ` · ${reservation.project}` : ''}`, M, 78);
  doc.fillColor('#ffffff').fontSize(12).text(`Receipt SH-${reservation.id}`, W - M - 200, 34, { width: 200, align: 'right' });
  doc.fontSize(9).fillColor('#cbd5e1').text(`Issued ${new Date().toISOString().slice(0, 10)}`, W - M - 200, 54, { width: 200, align: 'right' });

  let y = 142;
  const cell = (label, value, x, w) => {
    doc.fillColor(MUTED).fontSize(8).text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.8 });
    doc.fillColor('#14213d').fontSize(11).text(value || '—', x, y + 12, { width: w });
  };
  const colW = (W - 2 * M) / 3;
  cell('Guest', reservation.guest_name, M, colW);
  cell('Phone', reservation.guest_phone, M + colW, colW);
  cell('Stay', `${day(reservation.check_in)} to ${day(reservation.check_out)}`, M + 2 * colW, colW);
  y += 40;
  cell('Nights', nights ? String(nights) : '—', M, colW);
  cell('Email', reservation.guest_email, M + colW, colW * 2);
  y += 44;
  doc.moveTo(M, y).lineTo(W - M, y).strokeColor(LINE).stroke();
  y += 16;

  const tiles = [['Total', `EGP ${money(total)}`], ['Paid', `EGP ${money(paid)}`], [due > 0 ? 'Balance due' : 'Status', due > 0 ? `EGP ${money(due)}` : 'Paid in full']];
  const tw = (W - 2 * M - 20) / 3;
  tiles.forEach(([k, v], i) => {
    const x = M + i * (tw + 10);
    doc.roundedRect(x, y, tw, 52, 8).fill(i === 2 ? NAVY : '#f6f1e7');
    doc.fillColor(i === 2 ? '#cbd5e1' : MUTED).fontSize(8).text(k.toUpperCase(), x + 12, y + 11, { width: tw - 24 });
    doc.fillColor(i === 2 ? '#ffffff' : '#14213d').fontSize(13).text(v, x + 12, y + 25, { width: tw - 24 });
  });
  y += 76;

  doc.fillColor(MUTED).fontSize(9).text('PAYMENTS', M, y, { characterSpacing: 1.2 });
  y += 16;
  doc.rect(M, y, W - 2 * M, 22).fill('#f8fafc');
  doc.fillColor(MUTED).fontSize(8).text('DATE', M + 8, y + 7).text('METHOD', M + 120, y + 7).text('AMOUNT', W - M - 128, y + 7, { width: 120, align: 'right' });
  y += 26;
  if (!payments.length) {
    doc.fillColor('#94a3b8').fontSize(10).text('No payments recorded yet.', M + 8, y);
    y += 20;
  }
  for (const payment of payments) {
    doc.fillColor('#14213d').fontSize(10)
      .text(day(payment.payment_date), M + 8, y)
      .text(payment.payment_method || 'payment', M + 120, y)
      .text(`EGP ${money(payment.amount)}`, W - M - 128, y, { width: 120, align: 'right' });
    y += 18;
    doc.moveTo(M, y - 4).lineTo(W - M, y - 4).strokeColor(LINE).stroke();
  }

  doc.fillColor(MUTED).fontSize(9).text('Thank you for staying with Soul Hospitality. Keep this receipt for your records.', M, doc.page.height - 70, { width: W - 2 * M });
  doc.text(`soulhospitality.co · Receipt SH-${reservation.id}`, M, doc.page.height - 54, { width: W - 2 * M });
  doc.end();
  return done.then((buffer) => {
    if (res) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="receipt-SH-${reservation.id}.pdf"`);
      res.send(buffer);
    }
    return buffer;
  });
}

router.get('/reservations/:id/receipt.pdf', requireRoles(...STAFF_EDITOR_ROLES), async (req, res, next) => {
  try {
    const loaded = await loadReceipt(req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Reservation not found' });
    await renderReceipt(res, loaded.reservation, loaded.payments);
  } catch (err) {
    next(err);
  }
});

router.post('/reservations/:id/receipt/email', requireRoles(...STAFF_EDITOR_ROLES), async (req, res, next) => {
  try {
    const loaded = await loadReceipt(req.params.id);
    if (!loaded) return res.status(404).json({ error: 'Reservation not found' });
    const to = String(loaded.reservation.guest_email || '').trim();
    if (!to) return res.status(400).json({ error: 'This reservation has no guest email' });
    const buffer = await renderReceipt(null, loaded.reservation, loaded.payments);
    await sendEmail({
      to,
      subject: `Your Soul Hospitality receipt SH-${loaded.reservation.id}`,
      text: `Your receipt for ${loaded.reservation.unit_label || 'your stay'} is attached.`,
      html: `<p>Your receipt for ${loaded.reservation.unit_label || 'your stay'} is attached.</p>`,
      attachments: [{ filename: `receipt-SH-${loaded.reservation.id}.pdf`, content: buffer }],
    });
    res.json({ ok: true, sent_to: to });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
