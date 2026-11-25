// Verified identity (review H3): claim format and signing, configuration checks. Pure: no database.
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const identity = require('./identity');

const KEY = 'a'.repeat(64);
describe('ledger identity claims', () => {
  let saved;
  beforeEach(() => { saved = { id: process.env.LEDGER_IDENTITY_KEY_ID, k: process.env.LEDGER_IDENTITY_KEY }; });
  afterEach(() => {
    if (saved.id === undefined) delete process.env.LEDGER_IDENTITY_KEY_ID; else process.env.LEDGER_IDENTITY_KEY_ID = saved.id;
    if (saved.k === undefined) delete process.env.LEDGER_IDENTITY_KEY; else process.env.LEDGER_IDENTITY_KEY = saved.k;
  });

  it('signs v1.<key>.<actor>.<txid>.<expiry>.act.<HMAC-SHA256 of the |-joined fields>', () => {
    const secret = Buffer.from(KEY, 'hex');
    const claim = identity.signClaim({ keyId: 'k1', secret, actorId: 42, txid: '123456', expiry: 1900000000 });
    const parts = claim.split('.');
    assert.deepEqual(parts.slice(0, 6), ['v1', 'k1', '42', '123456', '1900000000', 'act']);
    assert.equal(parts[6], crypto.createHmac('sha256', secret).update('v1|k1|42|123456|1900000000|act').digest('hex'));
  });

  it('a different actor, transaction or expiry changes the signature', () => {
    const secret = Buffer.from(KEY, 'hex');
    const base = { keyId: 'k1', secret, actorId: 42, txid: '1', expiry: 2 };
    const sig = (o) => identity.signClaim({ ...base, ...o }).split('.')[6];
    assert.notEqual(sig({}), sig({ actorId: 43 }));
    assert.notEqual(sig({}), sig({ txid: '2' }));
    assert.notEqual(sig({}), sig({ expiry: 3 }));
  });

  it('refuses a short or malformed key and an invalid key id', () => {
    process.env.LEDGER_IDENTITY_KEY_ID = 'k1';
    process.env.LEDGER_IDENTITY_KEY = 'abcd';
    assert.throws(() => identity.identityKey(), /at least 64 hex/);
    process.env.LEDGER_IDENTITY_KEY = KEY;
    process.env.LEDGER_IDENTITY_KEY_ID = 'bad.id';
    assert.throws(() => identity.identityKey(), /invalid format/);
  });

  it('attestActor refuses to act for a person when no key is configured, and ignores system actions', async () => {
    delete process.env.LEDGER_IDENTITY_KEY_ID;
    delete process.env.LEDGER_IDENTITY_KEY;
    const db = { query: async () => ({ rows: [{ txid: '1', now: 0 }] }) };
    await assert.rejects(() => identity.attestActor(db, 7), (e) => e.code === 'IDENTITY_NOT_CONFIGURED');
    assert.equal(await identity.attestActor(db, null), null);
  });

  it('attestActor sets a claim bound to the transaction id the database reports', async () => {
    process.env.LEDGER_IDENTITY_KEY_ID = 'k1';
    process.env.LEDGER_IDENTITY_KEY = KEY;
    const calls = [];
    const db = { query: async (text, params) => { calls.push([text, params]); return { rows: [{ txid: '777', now: 1000 }] }; } };
    const claim = await identity.attestActor(db, 5, { ttlSeconds: 60 });
    assert.match(claim, /^v1\.k1\.5\.777\.1060\.act\.[0-9a-f]{64}$/);
    assert.deepEqual(calls[1], ["SELECT set_config('app.identity_claim', $1, true)", [claim]]);
  });

  it('rejects a non-numeric actor', async () => {
    await assert.rejects(() => identity.attestActor({ query: async () => ({ rows: [] }) }, "5' OR '1'='1"), (e) => e.code === 'BAD_ACTOR');
  });
});
