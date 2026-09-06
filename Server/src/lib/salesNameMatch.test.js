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

describe('salesNameMatch Abdelrahman isolation', () => {
  const staff = [
    { id: 1, full_name: 'Abdelrahman Dawod' },
    { id: 2, full_name: 'Abdelrahman Shaheen' },
  ];

  it('maps Mr Abdelrahman to Shaheen, not Dawod', () => {
    assert.equal(salesLabelBelongsToUser('Abdelrahman Dawod', staff[0]), true);
    assert.equal(salesLabelBelongsToUser('Abdelrahman Dawood', staff[0]), true);
    assert.equal(salesLabelBelongsToUser('Abdelrahman Shaheen', staff[1]), true);
    assert.equal(salesLabelBelongsToUser('Mr Abdelrahman', staff[1]), true);
    assert.equal(salesLabelBelongsToUser('Mr Abdelrahaman', staff[1]), true);

    assert.equal(salesLabelBelongsToUser('Abdelrahman Dawod', staff[1]), false);
    assert.equal(salesLabelBelongsToUser('Abdelrahman Shaheen', staff[0]), false);
    assert.equal(salesLabelBelongsToUser('Mr Abdelrahman', staff[0]), false);

    assert.equal(matchSalesLabelToStaff('Abdelrahman Dawod', staff)?.staff?.id, 1);
    assert.equal(matchSalesLabelToStaff('Abdelrahman Shaheen', staff)?.staff?.id, 2);
    assert.equal(matchSalesLabelToStaff('Mr Abdelrahman', staff)?.staff?.id, 2);
  });
});
