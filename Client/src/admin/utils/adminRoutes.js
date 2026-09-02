const A = '/admin';

export function defaultAdminPage(role) {
  switch (role) {
    case 'reservations':
    case 'reservations_web':
    case 'reservations_manual':
    case 'reservations_manager':
      return `${A}/reservations`;
    case 'operations':
    case 'operations_supervisor':
      return `${A}/operations`;
    case 'housekeeping':
    case 'housekeeping_supervisor':
      return `${A}/housekeeping`;
    case 'resale':
    case 'resale_manager':
      return `${A}/units-for-sale`;
    case 'unit_acquisition_agent':
    case 'unit_acquisition_manager':
      return `${A}/units`;
    case 'finance':
    case 'finance_manager':
      return `${A}/financial-system`;
    case 'hr':
    case 'hr_supervisor':
      return `${A}/users`;
    case 'owners_relations':
      return `${A}/reservations`;
    case 'marketing_pr':
    case 'web_developer':
      return `${A}/tasks`;
    case 'owner':
      return `${A}/owner`;
    default:
      return `${A}/dashboard`;
  }
}


export const ADMIN_LOGIN = '/sign-in';
export const ADMIN_CHANGE_PASSWORD = `${A}/change-password`;
export const ADMIN_OWNER_STATEMENT = `${A}/financial-system?tool=owners`;
