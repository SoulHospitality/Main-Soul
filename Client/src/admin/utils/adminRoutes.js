const A = '/admin';

export function defaultAdminPage(role) {
  switch (role) {
    case 'reservations':
    case 'reservations_web':
    case 'reservations_manual':
      return `${A}/reservations`;
    case 'operations':
    case 'operations_supervisor':
      return `${A}/operations`;
    case 'housekeeping':
    case 'housekeeping_supervisor':
      return `${A}/housekeeping`;
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


export const ADMIN_LOGIN = '/sign-in';
export const ADMIN_CHANGE_PASSWORD = `${A}/change-password`;
export const ADMIN_OWNER_STATEMENT = `${A}/financial-system?tool=owners`;
