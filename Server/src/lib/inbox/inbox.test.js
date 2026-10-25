const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { toPg } = require('./db');
const { normalizePhone, phoneTail, int, preview } = require('./http');
const { isBusinessTime, nextBusinessStart, localMinutes, isQuietHours } = require('./hours');
const { messagingWindow } = require('./outbound');
const { verifyMetaSignature, encrypt, decrypt } = require('./security');
const { can, permissionsFor } = require('./permissions');
const { scrub, PRICE_OR_PROMISE } = require('./ai');
const { fillPlaceholders } = require('./templates');

test('toPg numbers placeholders and leaves quoted question marks alone', () => {
  assert.equal(toPg('SELECT ? , ?'), 'SELECT $1 , $2');
  assert.equal(toPg("SELECT '?' AS q, ? AS v"), "SELECT '?' AS q, $1 AS v");
  assert.equal(toPg('UPDATE t SET a = ?::int WHERE id = ?'), 'UPDATE t SET a = $1::int WHERE id = $2');
});

test('normalizePhone handles Egyptian and international formats', () => {
  assert.equal(normalizePhone('01001234567'), '201001234567');
  assert.equal(normalizePhone('+20 100 123 4567'), '201001234567');
  assert.equal(normalizePhone('0020 1001234567'), '201001234567');
  assert.equal(normalizePhone('1001234567'), '201001234567');
  assert.equal(normalizePhone('٠١٠٠١٢٣٤٥٦٧'), '201001234567');
  assert.equal(normalizePhone('+971 50 123 4567'), '971501234567');
  assert.equal(normalizePhone('123'), null);
  assert.equal(normalizePhone(''), null);
});

test('phoneTail matches the same mobile in any format', () => {
  assert.equal(phoneTail('01001234567'), phoneTail('+201001234567'));
  assert.equal(phoneTail('12'), null);
});

test('int rejects non-positive and non-integer ids', () => {
  assert.equal(int('5'), 5);
  assert.throws(() => int('0'));
  assert.throws(() => int('abc'));
  assert.throws(() => int('1.5'));
});

test('preview collapses whitespace and truncates', () => {
  assert.equal(preview('  a \n b  '), 'a b');
  assert.equal(preview('x'.repeat(200), 10).length, 10);
});

// 2026-07-01 is in Cairo summer time (UTC+3).
const cairo = (hhmm) => Date.parse(`2026-07-01T${hhmm}:00+03:00`);
const hours = { business_start: '10:00', business_end: '24:00' };

test('business hours: inside and outside the window', () => {
  assert.equal(localMinutes(cairo('10:30')), 630);
  assert.equal(isBusinessTime(cairo('10:00'), hours), true);
  assert.equal(isBusinessTime(cairo('23:59'), hours), true);
  assert.equal(isBusinessTime(cairo('02:00'), hours), false);
  assert.equal(isBusinessTime(cairo('09:59'), hours), false);
});

test('business hours: overnight and 24/7 windows', () => {
  const overnight = { business_start: '20:00', business_end: '04:00' };
  assert.equal(isBusinessTime(cairo('22:00'), overnight), true);
  assert.equal(isBusinessTime(cairo('03:00'), overnight), true);
  assert.equal(isBusinessTime(cairo('12:00'), overnight), false);
  assert.equal(isBusinessTime(cairo('03:00'), { business_start: '00:00', business_end: '24:00' }), true);
});

test('free replies stay open for 24 hours after the customer writes', () => {
  const now = Date.parse('2026-07-01T12:00:00Z');
  assert.equal(messagingWindow({ last_inbound_at: now - 23 * 3600000 }, now).open, true);
  assert.equal(messagingWindow({ last_inbound_at: now - 25 * 3600000 }, now).open, false);
  assert.equal(messagingWindow({}, now).open, false);
});

test('quiet hours are after 10 PM and before 11 AM Cairo', () => {
  assert.equal(isQuietHours(cairo('22:00')), true);
  assert.equal(isQuietHours(cairo('23:30')), true);
  assert.equal(isQuietHours(cairo('00:10')), true);
  assert.equal(isQuietHours(cairo('10:59')), true);
  assert.equal(isQuietHours(cairo('11:00')), false);
  assert.equal(isQuietHours(cairo('21:59')), false);
});

test('after midnight is outside the 11:00–22:00 staff window', () => {
  const staff = { business_start: '11:00', business_end: '22:00' };
  assert.equal(isBusinessTime(cairo('00:05'), staff), false);
  assert.equal(isBusinessTime(cairo('10:59'), staff), false);
  assert.equal(isBusinessTime(cairo('11:00'), staff), true);
  assert.equal(isBusinessTime(cairo('21:59'), staff), true);
  assert.equal(isBusinessTime(cairo('22:00'), staff), false);
});

test('SLA clock starts at the next business opening for night messages', () => {
  assert.equal(nextBusinessStart(cairo('11:15'), hours), cairo('11:15'));
  assert.equal(nextBusinessStart(cairo('02:30'), hours), cairo('10:00'));
});

test('Meta signature verification', () => {
  const body = Buffer.from('{"object":"page"}');
  const sig = `sha256=${crypto.createHmac('sha256', 'secret').update(body).digest('hex')}`;
  assert.equal(verifyMetaSignature(body, sig, 'secret'), true);
  assert.equal(verifyMetaSignature(body, sig, 'other'), false);
  assert.equal(verifyMetaSignature(body, 'sha256=zz', 'secret'), false);
  assert.equal(verifyMetaSignature(null, sig, 'secret'), false);
});

test('channel tokens round-trip through encryption', () => {
  const enc = encrypt('EAAB-token');
  assert.notEqual(enc, 'EAAB-token');
  assert.equal(decrypt(enc), 'EAAB-token');
  assert.equal(encrypt(''), null);
});

test('inbox permissions by role', () => {
  assert.equal(can({ role: 'admin' }, 'channels.manage'), true);
  assert.equal(can({ role: 'manager' }, 'settings.manage'), true);
  assert.equal(can({ role: 'manager' }, 'channels.manage'), false);
  assert.equal(can({ role: 'supervisor' }, 'conv.assign'), true);
  assert.equal(can({ role: 'agent' }, 'conv.view_all'), false);
  assert.equal(can(null, 'conv.view_all'), false);
  assert.ok(permissionsFor({ role: 'admin' }).includes('simulator'));
});

test('saved replies insert the agent and guest names', () => {
  const body = 'أهلاً بيك في Soul Hospitality 🌊 معاك {{agent_name}}. أهلاً {{ customer_name }}';
  assert.equal(
    fillPlaceholders(body, { agentName: 'Hazem', customerName: 'Sara' }),
    'أهلاً بيك في Soul Hospitality 🌊 معاك Hazem. أهلاً Sara',
  );
  assert.equal(fillPlaceholders('no tokens', { agentName: 'Hazem' }), 'no tokens');
});

test('AI scrubbing and the night-reply price guard', () => {
  assert.match(scrub('ID 29801011234567'), /\[NATIONAL_ID\]/);
  assert.equal(PRICE_OR_PROMISE.test('السعر 5000 جنيه'), true);
  assert.equal(PRICE_OR_PROMISE.test('Your booking is confirmed'), true);
  assert.equal(PRICE_OR_PROMISE.test('أهلاً بيك! الفريق هيرد عليك من الساعة 10'), false);
});
