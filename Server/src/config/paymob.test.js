// Paymob HMAC verification (pure). The signature is computed independently here from Paymob's documented
// field order, so the test checks the verifier against the specification, not against itself.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyPaymobHmac } = require('./paymob');

const FIELDS = ['amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order', 'owner', 'pending',
  'source_data_pan', 'source_data_sub_type', 'source_data_type', 'success'];
const sign = (obj, secret) => crypto.createHmac('sha512', secret).update(FIELDS.map((k) => {
  if (k === 'order') return String(obj.order?.id ?? obj.order ?? '');
  if (k.startsWith('source_data_')) return String(obj.source_data?.[k.slice(12)] ?? '');
  return String(obj[k] ?? '');
}).join('')).digest('hex');
const txn = () => ({
  amount_cents: 300000, created_at: '2026-11-24T10:00:00', currency: 'EGP', error_occured: false, has_parent_transaction: false,
  id: 9001, integration_id: 77, is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false, is_standalone_payment: true,
  is_voided: false, order: { id: 5001, merchant_order_id: 'SOUL-1' }, owner: 12, pending: false,
  source_data: { pan: '2346', sub_type: 'MasterCard', type: 'card' }, success: true,
});

describe('Paymob webhook HMAC', () => {
  let saved;
  beforeEach(() => { saved = process.env.PAYMOB_HMAC_SECRET; process.env.PAYMOB_HMAC_SECRET = 'test-secret-not-real'; });
  afterEach(() => { if (saved === undefined) delete process.env.PAYMOB_HMAC_SECRET; else process.env.PAYMOB_HMAC_SECRET = saved; });

  it('accepts a correctly signed transaction (flat or wrapped in obj)', () => {
    const t = txn();
    const h = sign(t, 'test-secret-not-real');
    assert.equal(verifyPaymobHmac(t, h), true);
    assert.equal(verifyPaymobHmac({ obj: t, type: 'TRANSACTION' }, h), true);
  });
  it('rejects any change to a signed field (amount, success, order)', () => {
    const t = txn();
    const h = sign(t, 'test-secret-not-real');
    assert.equal(verifyPaymobHmac({ ...t, amount_cents: 1 }, h), false);
    assert.equal(verifyPaymobHmac({ ...t, success: false }, h), false);
    assert.equal(verifyPaymobHmac({ ...t, order: { id: 5002 } }, h), false);
  });
  it('rejects a signature made with another secret, a truncated one, or none', () => {
    const t = txn();
    assert.equal(verifyPaymobHmac(t, sign(t, 'other-secret')), false);
    assert.equal(verifyPaymobHmac(t, sign(t, 'test-secret-not-real').slice(0, 64)), false);
    assert.equal(verifyPaymobHmac(t, ''), false);
    assert.equal(verifyPaymobHmac(t, undefined), false);
  });
  it('fails closed when the secret is not configured', () => {
    delete process.env.PAYMOB_HMAC_SECRET;
    const t = txn();
    assert.equal(verifyPaymobHmac(t, sign(t, '')), false);
  });
});
