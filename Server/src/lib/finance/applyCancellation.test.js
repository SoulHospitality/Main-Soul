const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const dbPath = require.resolve('../../config/db');
const state = {
  closed: false,
  reservation: null,
  sql: [],
  inserted: null,
  noteLine: '',
};

async function handle(sql, params) {
  const text = String(sql);
  state.sql.push(text);
  if (/BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE/.test(text)) return { rows: [] };
  if (text.includes('financial_period_closes')) {
    return { rows: state.closed ? [{ year_month: '2026-11' }] : [] };
  }
  if (text.includes('FOR UPDATE')) {
    return { rows: state.reservation ? [{ ...state.reservation }] : [] };
  }
  if (text.includes('GROUP BY payment_method')) {
    return { rows: [{ payment_method: 'instapay', collected: 10000 }] };
  }
  if (text.includes('AS collected')) {
    return { rows: [{ collected: 10000 }] };
  }
  if (text.includes('INSERT INTO payments')) {
    state.inserted = params;
    return { rows: [] };
  }
  if (text.includes('DELETE FROM payments')) {
    throw new Error('collected payments must stay on the reservation');
  }
  if (text.includes("status = 'cancelled'") && text.includes('UPDATE reservations')) {
    state.noteLine = params?.[1] || '';
    state.reservation = { ...state.reservation, status: 'cancelled' };
    return { rows: [{ ...state.reservation }] };
  }
  if (text.includes('FROM reservations')) {
    return {
      rows: [{
        ...state.reservation,
        total_amount: 20000,
        down_payment: 10000,
      }],
    };
  }
  if (text.includes('SUM(amount)')) {
    return { rows: [{ paid: 6000, n: 2 }] };
  }
  if (text.includes('amount_paid')) {
    return { rows: [{ ...state.reservation, amount_paid: params?.[0] }] };
  }
  if (text.includes('audit_log')) return { rows: [] };
  return { rows: [] };
}

const client = {
  query: handle,
  release() { state.released = true; },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    pool: { connect: async () => client, query: handle },
    query: handle,
  },
};

const { applyCancellation } = require('./applyCancellation');
const { assertPeriodOpen, reopenReason } = require('./periodLock');
const { amountPaidFromRows } = require('../syncReservationPayment');

function stay() {
  state.closed = false;
  state.sql = [];
  state.inserted = null;
  state.noteLine = '';
  state.released = false;
  state.reservation = {
    id: 42,
    status: 'confirmed',
    check_in: '2026-11-02',
    check_out: '2026-11-05',
    amount_paid: 10000,
    payment_method: 'cash',
    payment_status: 'partial',
    unit_id: 7,
    notes: '',
  };
}

describe('apply cancellation on a fake database', () => {
  beforeEach(() => stay());

  it('records a partial refund and does not delete the collection', async () => {
    const row = await applyCancellation({
      reservationId: 42,
      user: { id: 3 },
      body: { cancel_type: 'refundable', refund_amount: 4000, reason: 'guest changed plans' },
    });
    assert.equal(row.status, 'cancelled');
    assert.equal(state.inserted[1], -4000);
    assert.equal(state.inserted[2], 'instapay');
    assert.match(state.inserted[4], /guest changed plans/);
    const written = state.sql.join('\n');
    assert.match(written, /kind/);
    assert.match(written, /'refund'/);
    assert.doesNotMatch(written, /DELETE FROM payments/);
    assert.doesNotMatch(written, /amount_paid = 0/);
    assert.equal(state.released, true);
  });

  it('keeps the deposit when the stay is non-refundable', async () => {
    await applyCancellation({
      reservationId: 42,
      user: { id: 3 },
      body: { cancel_type: 'non_refundable' },
    });
    assert.equal(state.inserted, null);
    assert.match(state.noteLine, /deposit kept/);
  });

  it('refuses a stay in a closed month', async () => {
    state.closed = true;
    await assert.rejects(
      () => applyCancellation({ reservationId: 42, user: { id: 3 }, body: { cancel_type: 'forfeit' } }),
      (err) => err.status === 409
    );
    assert.equal(state.inserted, null);
    assert.match(state.sql.join('\n'), /ROLLBACK/);
  });

  it('refuses a reservation that is already cancelled', async () => {
    state.reservation.status = 'cancelled';
    await assert.rejects(
      () => applyCancellation({ reservationId: 42, user: { id: 3 }, body: { cancel_type: 'refundable' } }),
      (err) => err.status === 409
    );
    assert.equal(state.inserted, null);
  });
});

describe('closed month and payment balance', () => {
  beforeEach(() => stay());

  it('locks a calendar date in a closed month and ignores a Date object', async () => {
    state.closed = true;
    await assert.rejects(
      () => assertPeriodOpen('2026-11-02', 'This payment date'),
      (err) => err.status === 409
    );
    await assertPeriodOpen(new Date(), 'This payment date');
  });

  it('requires a reason to reopen a month', () => {
    assert.equal(reopenReason({ reason: '  missed expense  ' }), 'missed expense');
    assert.throws(() => reopenReason({}), (err) => err.status === 400);
    assert.throws(() => reopenReason({ reason: '   ' }), (err) => err.status === 400);
  });

  it('nets refunds into the balance and does not fall back to the deposit', () => {
    assert.equal(amountPaidFromRows(6000, 2, 10000), 6000);
    assert.equal(amountPaidFromRows(0, 2, 10000), 0);
    assert.equal(amountPaidFromRows(0, 0, 10000), 10000);
  });
});
