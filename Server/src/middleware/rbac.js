const PERMS = {
  admin: ['*'],
  reservations: ['reservations', 'schedule', 'units_readonly', 'tasks'],
  reservations_web: ['reservations', 'schedule', 'units_readonly', 'website_bookings', 'tasks'],
  reservations_manual: ['reservations', 'schedule', 'units_readonly', 'tasks'],
  reservations_manager: [
    'reservations',
    'schedule',
    'performance',
    'reservation_audit',
    'units',
    'projects',
    'tasks',
  ],
  unit_acquisition_agent: ['units', 'reservations', 'schedule', 'tasks'],
  unit_acquisition_manager: [
    'units',
    'acquisition',
    'acquisition_audit',
    'reservations',
    'schedule',
    'owners',
    'owner_statement',
    'tasks',
  ],
  marketing_pr: ['tasks', 'reservations', 'schedule', 'units_readonly'],
  web_developer: ['tasks', 'site_performance'],
  hr: ['tasks', 'reservations'],
  hr_supervisor: ['tasks', 'reservations'],
  resale: ['units', 'projects', 'dashboard', 'tasks'],
  resale_manager: ['units', 'projects', 'dashboard', 'performance', 'tasks'],
  finance: ['financial_system', 'units', 'reservations', 'schedule', 'tasks'],
  finance_manager: ['financial_system', 'finance_audit', 'units', 'reservations', 'schedule', 'tasks'],
  operations: ['operations', 'housekeeping', 'reservations', 'schedule', 'tasks'],
  operations_supervisor: ['operations', 'housekeeping', 'reservations', 'schedule', 'tasks'],
  owners_relations: ['reservations', 'owner_statement', 'tasks'],
};

function can(user, permission) {
  if (!user) return false;
  const list = PERMS[user.role] || [];
  return list.includes('*') || list.includes(permission);
}

function requirePerm(permission) {
  return (req, res, next) => {
    if (!can(req.user, permission)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

module.exports = { can, requirePerm, PERMS };
