// Paymob webhook end to end on PGlite (real router, real migrations, synthetic sessions). Signatures are
// computed independently from Paymob's documented field order. No network calls; no real keys.
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { boot } = require('./harness');

const S = process.argv[2];
let failed = 0;
let passed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''}`); }
};
const SECRET = 'webhook-test-secret-not-real';
const FIELDS = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order', 'owner', 'pending',
  'source_data_pan', 'source_data_sub_type', 'source_data_type', 'success'];
const sign = (o) => crypto.createHmac('sha512', SECRET).update(FIELDS.map((k) => {
  if (k === 'order') return String(o.order?.id ?? '');
  if (k.startsWith('source_data_')) return String(o.source_data?.[k.slice(12)] ?? '');
  return String(o[k] ?? '');
}).join('')).digest('hex');
const txn = (merchantOrderId, { id = 9001, cents = 300000, success = true } = {}) => ({
  amount_cents: cents, created_at: '2026-11-24T10:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false,
  id, integration_id: 77, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true,
  is_voided: false, order: { id: id + 1000, merchant_order_id: merchantOrderId }, owner: 12, pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success,
});

(async () => {
  process.env.PAYMOB_HMAC_SECRET = SECRET;
  const { query } = await boot(S);
  const express = require(path.join(S, 'node_modules/express'));
  const unit = (await query(`INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests)
    VALUES ('pm-a','PM A','PM-A','published','rent','M','M',1,1,2) RETURNING id`)).rows[0].id;
  const session = async (mo, cents, checkin, checkout) => query(`INSERT INTO card_checkout_sessions (merchant_order_id, amount_cents, payload)
    VALUES ($1, $2, $3)`, [mo, cents, JSON.stringify({ slug: 'pm-a', listing_wp_id: 1, listing_title: 'PM A', checkin, checkout, guests: 2,
      total_egp: cents / 100, guest_name: 'Synthetic Guest', guest_email: 'synthetic@example.invalid', guest_phone: '0100', unit_id: unit })]);
  await session('SOUL-OK', 300000, '2027-04-01', '2027-04-04');
  await session('SOUL-FAIL', 200000, '2027-04-10', '2027-04-12');
  await session('SOUL-AMT', 250000, '2027-04-15', '2027-04-17');
  await session('SOUL-CLASH', 150000, '2027-05-01', '2027-05-03');
  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (950,'pm_admin','x','PM','admin',1)`);
  await query(`INSERT INTO reservations (unit_id, guest_name, check_in, check_out, nights, total_amount, status, created_by)
    VALUES ($1,'Existing Guest','2027-05-02','2027-05-04',2,2000,'confirmed',950)`, [unit]);

  const app = express();
  app.use(express.json());
  app.use('/api/payments', require(path.join(S, 'src/routes/payments.js')));
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  const server = http.createServer(app).listen(0);
  const url = `http://127.0.0.1:${server.address().port}/api/payments/paymob-webhook`;
  const hook = async (obj, hmac = sign(obj)) => {
    const r = await fetch(`${url}?hmac=${hmac}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'TRANSACTION', obj }) });
    let json = null; try { json = await r.json(); } catch (_) {}
    return { status: r.status, json };
  };
  const count = async (sql, p = []) => Number((await query(sql, p)).rows[0].n);
  const sessionStatus = async (mo) => (await query(`SELECT status FROM card_checkout_sessions WHERE merchant_order_id = $1`, [mo])).rows[0].status;

  // Signature checks.
  ok((await hook(txn('SOUL-OK'), 'deadbeef')).status === 401, 'an invalid HMAC is refused (401)');
  ok((await hook({ ...txn('SOUL-OK'), amount_cents: 1 }, sign(txn('SOUL-OK')))).status === 401, 'a payload altered after signing is refused (401)');
  ok((await count(`SELECT COUNT(*)::int n FROM payments`)) === 0 && (await sessionStatus('SOUL-OK')) === 'pending', 'refused callbacks change nothing');
  ok((await hook(txn('SOUL-NONE'))).status === 404, 'an unknown merchant order is refused (404)');
  // Failed payment and amount mismatch.
  const f = await hook(txn('SOUL-FAIL', { id: 9002, cents: 200000, success: false }));
  ok(f.status === 200 && f.json?.status === 'failed' && (await sessionStatus('SOUL-FAIL')) === 'failed' && (await count(`SELECT COUNT(*)::int n FROM bookings`)) === 0,
    'a failed payment marks the session failed and creates no booking or payment', f);
  const a = await hook(txn('SOUL-AMT', { id: 9003, cents: 100 }));
  ok(a.status === 409 && (await sessionStatus('SOUL-AMT')) === 'failed' && (await count(`SELECT COUNT(*)::int n FROM payments`)) === 0,
    'a paid amount different from the session is refused (409); no payment recorded', a);
  // Success, then duplicate callbacks.
  const s = await hook(txn('SOUL-OK', { id: 9010 }));
  const pay = (await query(`SELECT amount, payment_method, status, transaction_reference FROM payments`)).rows;
  const bk = (await query(`SELECT payment_status, payment_method, total_egp, unit_id FROM bookings`)).rows;
  ok(s.status === 200 && s.json?.ok && pay.length === 1 && Number(pay[0].amount) === 3000 && pay[0].payment_method === 'paymob_card' && pay[0].status === 'successful' && pay[0].transaction_reference === '9010',
    'a valid payment records one successful paymob_card payment of the session amount, referenced by the Paymob transaction id', pay);
  ok(bk.length === 1 && bk[0].payment_status === 'paid' && bk[0].unit_id === unit && (await sessionStatus('SOUL-OK')) === 'paid', 'the booking is created as paid and the session is marked paid', bk);
  const d1 = await hook(txn('SOUL-OK', { id: 9010 }));
  const d2 = await hook(txn('SOUL-OK', { id: 9010 }));
  ok(d1.json?.duplicate && d2.json?.duplicate && (await count(`SELECT COUNT(*)::int n FROM payments`)) === 1 && (await count(`SELECT COUNT(*)::int n FROM bookings`)) === 1,
    'repeated callbacks for a paid session are harmless duplicates: still one booking and one payment');
  // Dates taken while the guest was paying.
  await hook(txn('SOUL-CLASH', { id: 9020, cents: 150000 }));
  const clash = (await query(`SELECT notes FROM bookings WHERE checkin = '2027-05-01'`)).rows[0];
  ok(clash && /NEEDS ATTENTION/.test(clash.notes || ''), 'a payment for dates taken meanwhile still records the money but flags the booking for attention');
  // Fail closed without a secret.
  delete process.env.PAYMOB_HMAC_SECRET;
  ok((await hook(txn('SOUL-OK', { id: 9030 }))).status === 401, 'without PAYMOB_HMAC_SECRET every callback is refused (fails closed)');

  server.close();
  console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
