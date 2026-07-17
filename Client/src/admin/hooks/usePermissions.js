import { useAuth } from '../context/AuthContext';
import {
  hasPermission,
  canAccess,
  canManageUnits,
  canDeleteUnits,
  canManageReservations,
  canEditSchedulePricing,
  canAccessFinance,
  canManageUsers,
} from '../utils/permissions';

export function usePermissions() {
  const { user } = useAuth();
  return {
    can: (permission) => hasPermission(user, permission),
    canAccess: (page) => canAccess(user, page),
    canManageUnits: canManageUnits(user),
    canDeleteUnits: canDeleteUnits(user),
    canManageReservations: canManageReservations(user),
    canEditSchedulePricing: canEditSchedulePricing(user),
    canAccessFinance: canAccessFinance(user),
    canManageUsers: canManageUsers(user),
    isAdmin: user?.role === 'admin',
    isReservations: user?.role === 'reservations',
    isResale: user?.role === 'resale',
    isHr: user?.role === 'hr',
    // Legacy aliases used in older pages — map to new roles
    isFinance: user?.role === 'admin',
    isOpManager: user?.role === 'admin',
    isSales: user?.role === 'reservations',
    isOwnerExperience: user?.role === 'resale',
    isBroker: false,
    role: user?.role,
    user,
  };
}
