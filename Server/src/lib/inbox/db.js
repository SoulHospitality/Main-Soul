const { AsyncLocalStorage } = require('async_hooks');
const pgTypes = require('pg').types;
const { pool } = require('../../config/db');

// Inbox timestamps are bigint epoch ms; counts are bigint too. Return both as JS numbers.
const types = {
  getTypeParser(oid, format) {
    if (oid === 20 || oid === 1700) return (v) => (v === null ? null : Number(v));
    return pgTypes.getTypeParser(oid, format);
  },
};

const txStore = new AsyncLocalStorage();

/** Rewrites `?` placeholders to `$1..$n`, leaving quoted strings untouched. */
function toPg(sql) {
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '?') {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

const textCache = new Map();
function pgText(sql) {
  let t = textCache.get(sql);
  if (!t) {
    t = toPg(sql);
    if (textCache.size < 2000) textCache.set(sql, t);
  }
  return t;
}

function norm(params) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

// Timers created inside a transaction inherit its context; once it ends they fall back to the pool.
function runner() {
  const t = txStore.getStore();
  return t && !t.done ? t.client : pool;
}

async function exec(sql, params) {
  return runner().query({ text: pgText(sql), values: norm(params), types });
}

const q = {
  get: async (sql, ...params) => (await exec(sql, params)).rows[0],
  all: async (sql, ...params) => (await exec(sql, params)).rows,
  run: async (sql, ...params) => {
    const r = await exec(sql, params);
    return { changes: r.rowCount, id: r.rows[0]?.id ?? null };
  },
  /** INSERT ... and return the new id. */
  insert: async (sql, ...params) => {
    const r = await exec(/returning/i.test(sql) ? sql : `${sql} RETURNING id`, params);
    return { id: r.rows[0]?.id ?? null, changes: r.rowCount };
  },
};

/** Runs fn in one transaction; nested calls join the outer one. */
async function tx(fn) {
  const current = txStore.getStore();
  if (current && !current.done) return fn();
  const client = await pool.connect();
  const state = { client, done: false };
  try {
    await client.query('BEGIN');
    const result = await txStore.run(state, fn);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    state.done = true;
    client.release();
  }
}

/** Serialises work on one key inside the current transaction (e.g. one customer identity). */
async function lockKey(key) {
  await q.get('SELECT pg_advisory_xact_lock(hashtext(?))', `inbox:${key}`);
}

async function audit({ conversationId = null, leadId = null, userId = null, type, data = null, at = Date.now() }) {
  await q.run(
    'INSERT INTO inbox_events (conversation_id, lead_id, user_id, type, data_json, at) VALUES (?,?,?,?,?,?)',
    conversationId, leadId, userId, type, data ? JSON.stringify(data) : null, at,
  );
}

const parseJson = (v, fallback = null) => {
  if (v == null || v === '') return fallback;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

module.exports = { q, tx, audit, lockKey, toPg, parseJson };
