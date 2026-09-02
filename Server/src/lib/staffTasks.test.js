const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { canAssignTaskTo, canManageStaffTasks, isTaskAssigneeRole } = require('./staffTasks');

describe('staff task access', () => {
  it('recognizes task assignee roles', () => {
    assert.equal(isTaskAssigneeRole('hr'), true);
    assert.equal(isTaskAssigneeRole('web_developer'), true);
    assert.equal(isTaskAssigneeRole('hr_supervisor'), false);
  });

  it('lets HR Supervisor assign tasks to HR staff without a direct manager', () => {
    const hrSuper = { id: 8, role: 'hr_supervisor' };
    const hrStaff = { id: 11, role: 'hr', manager_id: null, manager_ids: [] };
    assert.equal(canAssignTaskTo(hrSuper, hrStaff), true);
  });

  it('lets any assigned web developer manager assign tasks', () => {
    const secondaryManager = { id: 8, role: 'hr_supervisor' };
    const webDev = { id: 20, role: 'web_developer', manager_id: 5, manager_ids: [5, 8] };
    assert.equal(canAssignTaskTo(secondaryManager, webDev), true);
  });

  it('lets CEO assign tasks to marketing and web developer staff', () => {
    const admin = { id: 1, role: 'admin' };
    assert.equal(canAssignTaskTo(admin, { id: 30, role: 'marketing_pr', manager_id: null }), true);
    assert.equal(canAssignTaskTo(admin, { id: 31, role: 'web_developer', manager_id: null }), true);
  });

  it('blocks managers from staff outside their scope', () => {
    const reservationsManager = { id: 12, role: 'reservations_manager' };
    const hrStaff = { id: 11, role: 'hr', manager_id: null };
    assert.equal(canAssignTaskTo(reservationsManager, hrStaff), false);
    assert.equal(canManageStaffTasks({ role: 'hr' }), false);
    assert.equal(canManageStaffTasks({ role: 'hr_supervisor' }), true);
  });
});
