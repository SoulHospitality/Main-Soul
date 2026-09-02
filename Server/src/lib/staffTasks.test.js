const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isStaffTaskManagerRole } = require('./staffManagers');
const {
  canAssignTaskTo,
  canManageStaffTasks,
  canReceiveStaffTasks,
  isTaskAssigneeRole,
} = require('./staffTasks');

describe('staff task access', () => {
  it('treats CEOs and every manager role as task assigners', () => {
    assert.equal(isStaffTaskManagerRole('admin'), true);
    assert.equal(isStaffTaskManagerRole('hr_supervisor'), true);
    assert.equal(isStaffTaskManagerRole('reservations_manager'), true);
    assert.equal(isStaffTaskManagerRole('finance_manager'), true);
    assert.equal(isStaffTaskManagerRole('operations_supervisor'), true);
    assert.equal(isStaffTaskManagerRole('housekeeping_supervisor'), true);
    assert.equal(canManageStaffTasks({ role: 'resale_manager' }), true);
  });

  it('lets staff receive tasks but not managers or owners', () => {
    assert.equal(canReceiveStaffTasks('reservations_web'), true);
    assert.equal(canReceiveStaffTasks('web_developer'), true);
    assert.equal(canReceiveStaffTasks('hr'), true);
    assert.equal(canReceiveStaffTasks('hr_supervisor'), false);
    assert.equal(canReceiveStaffTasks('reservations_manager'), false);
    assert.equal(canReceiveStaffTasks('owner'), false);
    assert.equal(canReceiveStaffTasks('admin'), false);
    assert.equal(isTaskAssigneeRole({ role: 'marketing_pr' }), true);
    assert.equal(isTaskAssigneeRole({ role: 'finance_manager' }), false);
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

  it('blocks assigning tasks to other managers', () => {
    const admin = { id: 1, role: 'admin' };
    const reservationsManager = { id: 12, role: 'reservations_manager' };
    assert.equal(canAssignTaskTo(admin, { id: 12, role: 'reservations_manager' }), false);
    assert.equal(
      canAssignTaskTo(reservationsManager, { id: 20, role: 'web_developer', manager_id: 5 }),
      false
    );
  });
});
