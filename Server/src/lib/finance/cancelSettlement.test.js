const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCancelSettlement, forfeitBase } = require('./cancelSettlement');

describe('cancel settlement', () => {
  it('keeps the collection and refunds all of it', () => {
    const result = resolveCancelSettlement({ cancelType: 'refundable', collected: 10000 });
    assert.equal(result.choice, 'full_refund');
    assert.equal(result.refund, 10000);
    assert.equal(result.kept, 0);
  });

  it('refunds part of the collection and forfeits the rest', () => {
    const result = resolveCancelSettlement({
      cancelType: 'refundable',
      refundAmount: 4000,
      collected: 10000,
    });
    assert.equal(result.choice, 'partial_refund');
    assert.equal(result.refund, 4000);
    assert.equal(result.kept, 6000);
    assert.equal(forfeitBase(10000, 4000), 6000);
  });

  it('forfeits the deposit when the stay is non-refundable', () => {
    const result = resolveCancelSettlement({ cancelType: 'non_refundable', collected: 10000 });
    assert.equal(result.choice, 'forfeit');
    assert.equal(result.refund, 0);
    assert.equal(result.kept, 10000);
    assert.equal(forfeitBase(10000, 0), 10000);
  });

  it('refuses a refund larger than the amount collected', () => {
    assert.throws(
      () => resolveCancelSettlement({ settlement: 'partial_refund', refundAmount: 50, collected: 10 }),
      (err) => err.status === 400
    );
  });
});
