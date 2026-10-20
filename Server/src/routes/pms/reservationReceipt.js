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
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(18).text('Soul Hospitality');
  doc.moveDown(0.3);
  doc.fontSize(14).text('Reservation receipt');
  doc.fontSize(10).fillColor('#444');
  doc.text(`Receipt SH-${reservation.id}`);
  doc.text(`${reservation.unit_label || 'Unit'}${reservation.project ? ` · ${reservation.project}` : ''}`);
  doc.moveDown();
  doc.fillColor('#111').fontSize(11);
  doc.text(`Guest  ${reservation.guest_name || ''}`);
  if (reservation.guest_phone) doc.text(`Phone  ${reservation.guest_phone}`);
  if (reservation.guest_email) doc.text(`Email  ${reservation.guest_email}`);
  doc.text(`Stay  ${String(reservation.check_in).slice(0, 10)} to ${String(reservation.check_out).slice(0, 10)} · ${reservation.nights || ''} nights`);
  doc.moveDown();
  doc.text(`Accommodation  EGP ${money(reservation.total_amount)}`);
  doc.text(`Paid  EGP ${money(reservation.amount_paid)}`);
  const due = Math.max(0, Number(reservation.total_amount || 0) - Number(reservation.amount_paid || 0));
  doc.fontSize(13).text(`Balance  EGP ${money(due)}`);
  doc.moveDown();
  doc.fontSize(12).text('Payments');
  doc.fontSize(10);
  if (!payments.length) doc.text('No payments recorded yet.');
  for (const payment of payments) {
    doc.text(`${String(payment.payment_date).slice(0, 10)} · ${payment.payment_method || 'payment'} · EGP ${money(payment.amount)}`);
  }
  doc.moveDown(2);
  doc.fontSize(9).fillColor('#666').text('Thank you for staying with Soul Hospitality.');
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
