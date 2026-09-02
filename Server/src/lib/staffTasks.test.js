const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  canAssignTaskTo,
  canManageStaffTasks,
  canReceiveStaffTasks,
  isTaskAssigneeRole,
} = require('./staffTasks');

describe('staff task access', () => {
  it('lets any staff except owner/admin receive tasks', () => {
    assert.equal(canReceiveStaffTasks('reservations_web'), true);
    assert.equal(canReceiveStaffTasks('web_developer'), true);
    assert.equal(canReceiveStaffTasks('owner'), false);
    assert.equal(canReceiveStaffTasks('admin'), false);
  });

  it('uses assignee view for staff and manager view for line managers', () => {
    assert.equal(isTaskAssigneeRole({ role: 'hr' }), true);
    assert.equal(isTaskAssigneeRole({ role: 'reservations_web' }), true);
    assert.equal(isTaskAssigneeRole({ role: 'hr_supervisor' }), false);
    assert.equal(isTaskAssigneeRole({ role: 'admin' }), false);
  });

  it('lets HR Supervisor assign tasks to direct reports including web developers', () => {
    const hrSuper = { id: 8, role: 'hr_supervisor' };
    const webDev = { id: 20, role: 'web_developer', manager_id: 5, manager_ids: [5, 8] };
    const hrStaff = { id: 11, role: 'hr', manager_id: null, manager_ids: [] };
    assert.equal(canAssignTaskTo(hrSuper, webDev), true);
    assert.equal(canAssignTaskTo(hrSuper, hrStaff), true);
  });

  it('lets department managers assign tasks to their team', () => {
    const reservationsManager = { id: 12, role: 'reservations_manager' };
    const agent = { id: 21, role: 'reservations_web', manager_id: null, manager_ids: [] };
    assert.equal(canAssignTaskTo(reservationsManager, agent), true);
  });

  it('lets CEO assign tasks to marketing and web developer staff', () => {
    const admin = { id: 1, role: 'admin' };
    assert.equal(canAssignTaskTo(admin, { id: 30, role: 'marketing_pr', manager_id: null }), true);
    assert.equal(canAssignTaskTo(admin, { id: 31, role: 'web_developer', manager_id: null }), true);
  });

  it('blocks managers from staff outside their scope', () => {
    const reservationsManager = { id: 12, role: 'reservations_manager' };
    const webDev = { id: 20, role: 'web_developer', manager_id: 5, manager_ids: [5] };
    assert.equal(canAssignTaskTo(reservationsManager, webDev), false);
    assert.equal(canManageStaffTasks({ role: 'hr' }), false);
    assert.equal(canManageStaffTasks({ role: 'hr_supervisor' }), true);
    assert.equal(canManageStaffTasks({ role: 'housekeeping_supervisor' }), true);
  });
});
