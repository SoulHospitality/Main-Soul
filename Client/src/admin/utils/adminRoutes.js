const A = '/admin';

export function defaultAdminPage(role) {
  switch (role) {
    case 'reservations':
    case 'reservations_web':
    case 'reservations_manual':
      return `${A}/reservations`;
    case 'operations':
      return `${A}/ops/checkins-today`;
    case 'housekeeping':
      return `${A}/housekeeping/today`;
    case 'resale':
      return `${A}/units-for-sale`;
    case 'hr':
      return `${A}/users`;
    case 'owner':
      return `${A}/owner`;
    default:
      return `${A}/dashboard`;
  }
}

/** Unified guest+staff sign-in (no separate admin login page). */
export const ADMIN_LOGIN = '/sign-in';
export const ADMIN_CHANGE_PASSWORD = `${A}/change-password`;
export const ADMIN_OWNER_STATEMENT = `${A}/owner-statement`;
