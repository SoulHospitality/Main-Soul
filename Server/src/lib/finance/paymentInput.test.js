const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { assertCollectionAmount, normalizeIdempotencyKey } = require('./paymentInput');

describe('payment input', () => {
  it('accepts a positive amount with at most 2 decimals', () => {
    assert.equal(assertCollectionAmount('1500.50'), 1500.5);
  });

  it('rejects zero, negative, and a third decimal', () => {
    assert.throws(() => assertCollectionAmount(0), (err) => err.status === 400);
    assert.throws(() => assertCollectionAmount(-20), (err) => err.status === 400);
    assert.throws(() => assertCollectionAmount('10.555'), (err) => err.status === 400);
  });

  it('trims the idempotency key and caps it at 80 characters', () => {
    assert.equal(normalizeIdempotencyKey('  abc  '), 'abc');
    assert.equal(normalizeIdempotencyKey(''), '');
    assert.equal(normalizeIdempotencyKey('x'.repeat(100)).length, 80);
  });
});
