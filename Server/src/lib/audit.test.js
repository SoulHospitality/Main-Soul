const test = require('node:test');
const assert = require('node:assert/strict');
const { diffChanges } = require('./audit');

test('diffChanges reports only fields that changed', () => {
  const before = { id: 1, guest_name: 'Ali', total_amount: '1000', check_in: '2026-11-01', notes: null };
  const after = { id: 1, guest_name: 'Ali', total_amount: 1200, check_in: '2026-11-02', notes: '' };
  assert.deepEqual(diffChanges(before, after), {
    total_amount: { from: 1000, to: 1200 },
    check_in: { from: '2026-11-01', to: '2026-11-02' },
  });
});

test('diffChanges treats empty strings and null as the same and skips objects', () => {
  const before = { notes: null, photos: ['a'], updated_at: '2026-01-01' };
  const after = { notes: '', photos: ['b'], updated_at: '2026-02-02' };
  assert.deepEqual(diffChanges(before, after), {});
});

test('diffChanges compares numeric strings as numbers', () => {
  assert.deepEqual(diffChanges({ amount: '250.00' }, { amount: 250 }), {});
});

test('diffChanges can be limited to a field list', () => {
  const changes = diffChanges({ a: 1, b: 2 }, { a: 5, b: 9 }, ['b']);
  assert.deepEqual(changes, { b: { from: 2, to: 9 } });
});

test('diffChanges returns nothing without both rows', () => {
  assert.deepEqual(diffChanges(null, { a: 1 }), {});
});
