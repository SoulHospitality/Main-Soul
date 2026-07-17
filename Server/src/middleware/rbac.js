const PERMS = {
  admin: ['*'],
  reservations: ['reservations', 'schedule', 'dashboard', 'units_readonly'],
  resale: ['units', 'projects', 'dashboard'],
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
