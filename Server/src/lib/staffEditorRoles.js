/**
 * Staff roles that may add/edit units (short and long term) and add/edit reservations.
 * Every staff role except marketing_pr and web_developer (owners are not staff).
 */
const STAFF_EDITOR_ROLES = [
  'admin',
  'reservations',
  'reservations_web',
  'reservations_manual',
  'reservations_manager',
  'unit_acquisition_agent',
  'unit_acquisition_manager',
  'operations',
  'operations_supervisor',
  'resale',
  'resale_manager',
  'finance',
  'finance_manager',
  'hr',
  'hr_supervisor',
  'owners_relations',
];

function isStaffEditorRole(userOrRole) {
  const role = typeof userOrRole === 'string' ? userOrRole : userOrRole?.role;
  return STAFF_EDITOR_ROLES.includes(String(role || ''));
}

module.exports = { STAFF_EDITOR_ROLES, isStaffEditorRole };
