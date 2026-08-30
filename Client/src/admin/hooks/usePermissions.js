import { useAuth } from '../context/AuthContext';
import {
  hasPermission,
  canAccess,
  canManageUnits,
  canDeleteUnits,
  canManageReservations,
  canHandleWebsiteBookings,
  canViewAllReservations,
  canEditOrChecklist,
  canEditSchedulePricing,
  canAccessFinance,
  canAccessFinancialSystem,
  canManageUsers,
  isReservationsTeam,
  isWebsiteReservationsRole,
  isManualReservationsRole,
  isOwnersRelationsRole,
} from '../utils/permissions';

export function usePermissions() {
  const { user } = useAuth();
  const isReservations = isReservationsTeam(user);
  const isWebsiteReservations = isWebsiteReservationsRole(user);
  const isManualReservations = isManualReservationsRole(user);
  const isOwnersRelations = isOwnersRelationsRole(user);

  return {
    can: (permission) => hasPermission(user, permission),
    canAccess: (page) => canAccess(user, page),
    canManageUnits: canManageUnits(user),
    canDeleteUnits: canDeleteUnits(user),
    canManageReservations: canManageReservations(user),
    canHandleWebsiteBookings: canHandleWebsiteBookings(user),
    canViewAllReservations: canViewAllReservations(user),
    canEditOrChecklist: canEditOrChecklist(user),
    canEditSchedulePricing: canEditSchedulePricing(user),
    canAccessFinance: canAccessFinance(user),
    canAccessFinancialSystem: canAccessFinancialSystem(user),
    canManageUsers: canManageUsers(user),
    isAdmin: user?.role === 'admin',
    isReservations,
    isWebsiteReservations,
    isManualReservations,
    isOwnersRelations,
    isResale: user?.role === 'resale',
    isHr: user?.role === 'hr' || user?.role === 'hr_supervisor',
    isHrSupervisor: user?.role === 'hr_supervisor',
    isOwner: user?.role === 'owner',
    
    isFinance: user?.role === 'admin',
    isOpManager: user?.role === 'admin',
    isSales: isReservations,
    isOwnerExperience: user?.role === 'resale',
    isBroker: false,
    role: user?.role,
    user,
  };
}
