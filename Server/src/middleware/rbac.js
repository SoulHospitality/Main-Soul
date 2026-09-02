const PERMS = {
  admin: ['*'],
  reservations: ['reservations', 'schedule', 'dashboard', 'units_readonly'],
  reservations_web: ['reservations', 'schedule', 'dashboard', 'units_readonly'],
  reservations_manual: ['reservations', 'schedule', 'dashboard', 'units_readonly'],
  reservations_manager: ['reservations', 'schedule', 'calendar_sync', 'performance'],
  unit_acquisition_agent: ['units', 'acquisition'],
  unit_acquisition_manager: ['units', 'acquisition', 'acquisition_audit'],
  marketing_pr: ['tasks'],
  web_developer: ['tasks'],
  resale: ['units', 'projects', 'dashboard'],
  resale_manager: ['units', 'projects', 'dashboard', 'performance'],
  finance_manager: ['financial_system', 'finance_audit'],
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
