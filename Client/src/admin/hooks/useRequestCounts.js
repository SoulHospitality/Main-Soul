import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';

export const REQUEST_CATEGORIES = [
  { id: 'holiday', label: 'Holiday', short: 'Holiday' },
  { id: 'excuse', label: 'Excuse', short: 'Excuse' },
  { id: 'mission', label: 'Mission', short: 'Mission' },
  { id: 'wfh', label: 'Work from home', short: 'WFH' },
  { id: 'loan', label: 'Loan', short: 'Loan' },
];

const EMPTY = {
  review: { holiday: 0, excuse: 0, mission: 0, wfh: 0, loan: 0, total: 0 },
  mine: { holiday: 0, excuse: 0, mission: 0, wfh: 0, loan: 0, total: 0 },
  unseen_decisions: 0,
};

/**
 * Requests waiting for this person (by type), their own pending ones, and decisions they haven't seen.
 * Refreshed live by the `pms:requests` socket event (see useLiveNotifications), with polling as a fallback.
 */
export function useRequestCounts(user, enabled = true) {
  const { data } = useQuery({
    queryKey: ['hr-requests-counts', user?.id],
    queryFn: () => api.get('/hr/requests/counts').then((r) => r.data),
    enabled: Boolean(enabled && user?.id && user.role !== 'owner'),
    refetchInterval: 60000,
    staleTime: 5000,
  });
  return data || EMPTY;
}
