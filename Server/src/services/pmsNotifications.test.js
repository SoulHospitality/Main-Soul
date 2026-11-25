const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Replace the database and socket modules before loading the service.
const inserts = [];
const emitted = [];
function fakeQuery(sql, params) {
  if (/FROM staff_users/.test(sql)) return { rows: [{ id: 7 }, { id: 8 }] };
  if (/INSERT INTO notifications/.test(sql)) {
    const entityId = params[5];
    // Mirrors Postgres: notifications.entity_id is integer.
    if (entityId != null && !/^-?\d+$/.test(String(entityId))) {
      throw new Error(`invalid input syntax for type integer: "${entityId}"`);
    }
    inserts.push(params);
    return { rows: [{ id: inserts.length, user_id: params[0], type: params[1], title: params[2], message: params[3], entity_type: params[4], entity_id: entityId, created_at: new Date() }] };
  }
  if (/SELECT id FROM notifications/.test(sql)) return { rows: [] };
  throw new Error(`unexpected query: ${sql}`);
}
const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
stub('../config/db', { query: async (sql, params) => fakeQuery(sql, params) });
stub('../config/socket', { emitSalesNotification: (userId, n) => emitted.push({ userId, n }) });

const {
  toIntegerEntityId,
  notifyStaff,
  notifyNewWebsiteBooking,
  notifyWebsiteBookingAccepted,
  notifyWebsiteBookingRejected,
} = require('./pmsNotifications');

const BOOKING = {
  id: '3f6c2a1e-9b7d-4c1a-8e2f-5a6b7c8d9e0f',
  guest_name: 'Test Guest',
  listing_title: 'Unit 12',
  guests: 2,
  total_egp: 12500,
  assigned_sales_id: 9,
};

describe('pmsNotifications entity ids', () => {
  beforeEach(() => { inserts.length = 0; emitted.length = 0; });

  it('keeps integer ids and drops anything the integer column cannot hold', () => {
    assert.equal(toIntegerEntityId(42), 42);
    assert.equal(toIntegerEntityId('42'), 42);
    assert.equal(toIntegerEntityId(' 17 '), 17);
    assert.equal(toIntegerEntityId(BOOKING.id), null);
    assert.equal(toIntegerEntityId('12abc'), null);
    assert.equal(toIntegerEntityId(1.5), null);
    assert.equal(toIntegerEntityId(null), null);
    assert.equal(toIntegerEntityId(undefined), null);
    assert.equal(toIntegerEntityId(''), null);
    assert.equal(toIntegerEntityId('99999999999999999999'), null);
  });

  it('a new website booking (UUID id) notifies every web-team user', async () => {
    const created = await notifyNewWebsiteBooking(BOOKING);
    assert.equal(created.length, 2);
    assert.deepEqual(inserts.map((p) => p[0]), [7, 8]);
    for (const p of inserts) {
      assert.equal(p[1], 'new_booking');
      assert.equal(p[4], 'booking');
      assert.equal(p[5], null);
      assert.match(p[3], /Test Guest · Unit 12 · 2 guests/);
    }
    assert.equal(emitted.length, 2);
  });

  it('accepted and rejected website bookings notify too', async () => {
    const actor = { id: 7, full_name: 'Admin One' };
    const accepted = await notifyWebsiteBookingAccepted(BOOKING, actor);
    assert.deepEqual(accepted.map((r) => r.user_id).sort(), [8, 9]);
    const rejected = await notifyWebsiteBookingRejected(BOOKING, actor, 'dates taken');
    assert.ok(rejected.length >= 1);
    assert.ok(inserts.every((p) => p[5] === null));
  });

  it('integer entity ids are still stored', async () => {
    await notifyStaff({ userIds: [7], type: 'reservation_created', title: 't', message: 'm', entity_type: 'reservation', entity_id: 321 });
    assert.equal(inserts[0][5], 321);
  });
});
