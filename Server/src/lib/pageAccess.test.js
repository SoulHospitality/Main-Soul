const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, pageForPath, sanitizePageAccess, customScope, pmsPathOf } = require('./pageAccess');

const agent = (page_access) => ({ id: 9, role: 'reservations_web', page_access });

test('users without custom access keep their role rules', () => {
  assert.equal(decide(agent(null), 'POST', '/financial-system/manual').verdict, 'role');
  assert.equal(decide({ id: 1, role: 'admin', page_access: {} }, 'GET', '/audit-log').verdict, 'role');
});

test('a switched-off page is blocked, but shared lookups stay readable', () => {
  const user = agent({ reservations: { level: 'write', scope: 'own' } });
  assert.equal(decide(user, 'GET', '/financial-system/overview').verdict, 'deny');
  assert.equal(decide(user, 'GET', '/audit-log').verdict, 'deny');
  assert.equal(decide(user, 'GET', '/units').verdict, 'role');
  assert.equal(decide(user, 'PUT', '/units/abc').verdict, 'deny');
});

test('read-only pages refuse writes and allow reads', () => {
  const user = agent({ reservations: { level: 'read', scope: 'all' } });
  assert.equal(decide(user, 'GET', '/reservations/12').verdict, 'allow');
  assert.equal(decide(user, 'PUT', '/reservations/12').verdict, 'deny');
  assert.equal(decide(user, 'POST', '/payments').verdict, 'deny');
});

test('a granted page opens its routes for writing', () => {
  const user = agent({ financial_system: { level: 'write' } });
  assert.equal(decide(user, 'POST', '/financial-system/manual-entries').verdict, 'allow');
});

test('unmapped paths fall back to role rules', () => {
  assert.equal(decide(agent({}), 'GET', '/notifications').verdict, 'role');
});

test('the most specific prefix decides the page', () => {
  assert.equal(pageForPath('/reports/owner-statement'), 'owner_statement');
  assert.equal(pageForPath('/reports/by-unit'), 'reports');
  assert.equal(pageForPath('/housekeeping-tasks/4'), 'housekeeping');
  assert.equal(pageForPath('/housekeeping/today-cleans'), 'hk_today');
  assert.equal(pageForPath('/inbox/leads/3'), 'leads');
  assert.equal(pageForPath('/users/owners/2/units'), 'owners');
  assert.equal(pageForPath('/unitsx'), null);
});

test('request paths are read relative to /api/pms', () => {
  assert.equal(pmsPathOf({ baseUrl: '/api/pms', path: '/units/1' }), '/units/1');
  assert.equal(pmsPathOf({ baseUrl: '/api/pms/inbox', path: '/leads' }), '/inbox/leads');
});

test('sanitizePageAccess drops unknown pages and fixes invalid levels and scopes', () => {
  assert.equal(sanitizePageAccess(null), null);
  assert.deepEqual(
    sanitizePageAccess({
      reservations: { level: 'write', scope: 'everything' },
      audit_log: { level: 'write', scope: 'all' },
      nope: { level: 'write' },
    }),
    { reservations: { level: 'write', scope: 'role' }, audit_log: { level: 'read', scope: 'all' } }
  );
  assert.throws(() => sanitizePageAccess('x'));
});

test('customScope ignores the role-default scope', () => {
  assert.equal(customScope(agent({ reservations: { level: 'read', scope: 'role' } }), 'reservations'), null);
  assert.equal(customScope(agent({ reservations: { level: 'read', scope: 'team' } }), 'reservations'), 'team');
  assert.equal(customScope(agent(null), 'reservations'), null);
});
