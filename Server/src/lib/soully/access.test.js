const test = require('node:test');
const assert = require('node:assert/strict');
const { soullyCan, soullyEnabled, allowedGuide } = require('./access');

test('only the admin can open Soully', () => {
  assert.equal(soullyEnabled({ role: 'admin', is_active: true }), true);
  assert.equal(soullyEnabled({ role: 'admin', is_active: false }), false);
  assert.equal(soullyEnabled({ role: 'hr', is_active: true }), false);
  assert.equal(soullyEnabled({ role: 'reservations_web', is_active: true }), false);
  assert.equal(soullyCan({ role: 'admin' }, 'financial_system'), true);
  assert.equal(soullyCan({ role: 'admin' }, 'users'), true);
});

test('web developer cannot read finance, reservations, or other staff', () => {
  const user = { role: 'web_developer', is_active: true };
  assert.equal(soullyEnabled(user), false);
  assert.equal(soullyCan(user, 'site_performance'), true);
  assert.equal(soullyCan(user, 'financial_system'), false);
  assert.equal(soullyCan(user, 'reservations'), false);
  assert.equal(soullyCan(user, 'users'), false);
  assert.equal(soullyCan(user, 'payslip'), true);
  const pages = allowedGuide(user).map((item) => item.page);
  assert.ok(pages.includes('tasks'));
  assert.equal(pages.includes('financial_system'), false);
});

test('owners do not get Soully', () => {
  assert.equal(soullyEnabled({ role: 'owner', is_active: true }), false);
  assert.equal(soullyCan({ role: 'owner' }, 'profile'), false);
});

test('website reservations can see the request queue', () => {
  assert.equal(soullyCan({ role: 'reservations_web' }, 'website_bookings'), true);
  assert.equal(soullyCan({ role: 'reservations_manual' }, 'website_bookings'), false);
});
