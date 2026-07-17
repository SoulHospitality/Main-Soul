const A = '/admin';

export function defaultAdminPage(role) {
  switch (role) {
    case 'reservations':
      return `${A}/reservations`;
    case 'resale':
      return `${A}/units`;
    case 'hr':
      return `${A}/users`;
    default:
      return `${A}/dashboard`;
  }
}

/** Unified guest+staff sign-in (no separate admin login page). */
export const ADMIN_LOGIN = '/sign-in';
export const ADMIN_CHANGE_PASSWORD = `${A}/change-password`;
export const ADMIN_OWNER_STATEMENT = `${A}/owner-statement`;
