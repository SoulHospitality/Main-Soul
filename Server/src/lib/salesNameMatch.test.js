const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  nameMatchScore,
  salesLabelBelongsToUser,
  matchSalesLabelToStaff,
} = require('./salesNameMatch');

describe('salesNameMatch Osama isolation', () => {
  it('maps short label Osama to Ahmed Osama, not Mahmoud Osama', () => {
    assert.equal(salesLabelBelongsToUser('Osama', { full_name: 'Ahmed Osama' }), true);
    assert.equal(salesLabelBelongsToUser('Osama', { full_name: 'Mahmoud Osama' }), false);
    assert.equal(salesLabelBelongsToUser('Ahmed Osama', { full_name: 'Mahmoud Osama' }), false);
    assert.equal(salesLabelBelongsToUser('Mahmoud Osama', { full_name: 'Mahmoud Osama' }), true);
    assert.ok(nameMatchScore('Osama', 'Mahmoud Osama') < 0.74);
    assert.ok(nameMatchScore('Osama', 'Ahmed Osama') >= 0.74);

    const matched = matchSalesLabelToStaff('Osama', [
      { id: 1, full_name: 'Mahmoud Osama' },
      { id: 2, full_name: 'Ahmed Osama' },
    ]);
    assert.equal(matched?.staff?.id, 2);
  });
});
