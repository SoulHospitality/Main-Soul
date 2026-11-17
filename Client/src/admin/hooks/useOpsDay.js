import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';

/**
 * Shared operations queries. The keys and response shapes match the Check-ins, Checkouts and Cleaning tabs,
 * so the Today board, the tab badges and the tabs read one cached copy instead of fetching three times.
 */
const listOf = (data) => (Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : []);

export function useOpsCheckins(range = 'today', enabled = true) {
  return useQuery({
    queryKey: ['ops-checkins-today', range],
    queryFn: async () => {
      const r = await api.get('/ops/checkins-today', { params: { range } });
      return { items: listOf(r.data), range: r.data?.range || range, from: r.data?.from, to: r.data?.to };
    },
    refetchInterval: 20000,
    enabled,
  });
}

export function useOpsCheckouts(range = 'today', enabled = true) {
  return useQuery({
    queryKey: ['ops-checkouts-today', range],
    queryFn: async () => {
      const r = await api.get('/ops/checkouts-today', { params: { range } });
      return { items: listOf(r.data), range: r.data?.range || range, from: r.data?.from, to: r.data?.to };
    },
    refetchInterval: 20000,
    enabled,
  });
}

export function useHkCleans(range = 'today', enabled = true) {
  return useQuery({
    queryKey: ['hk-today-cleans', range],
    queryFn: async () => {
      const r = await api.get('/housekeeping/today-cleans', { params: { range } });
      return { items: listOf(r.data), from: r.data?.from, to: r.data?.to };
    },
    refetchInterval: 20000,
    enabled,
  });
}

export function useUnitBoard(range = 'today', enabled = true) {
  return useQuery({
    queryKey: ['ops-unit-board', range],
    queryFn: async () => (await api.get('/ops/unit-board', { params: { range } })).data,
    refetchInterval: 30000,
    enabled,
  });
}

/** Where each job of the day stands, for badges and the Today board. */
export function summarizeOpsDay({ checkins = [], checkouts = [], cleans = [] }) {
  const arrivalsDone = checkins.filter((r) => r.ops_handed_over).length;
  const departuresDone = checkouts.filter(
    (r) => r.status === 'checked_out' || ['refunded', 'partial', 'forfeited'].includes(r.insurance_refund_status)
  ).length;
  const cleansDone = cleans.filter((r) => r.cleaned).length;
  return {
    arrivals: { total: checkins.length, done: arrivalsDone, open: checkins.length - arrivalsDone },
    departures: { total: checkouts.length, done: departuresDone, open: checkouts.length - departuresDone },
    cleans: { total: cleans.length, done: cleansDone, open: cleans.length - cleansDone },
  };
}

export const UNIT_STATES = {
  turnover: { label: 'Turnover today', tone: 'bg-rose-50 border-rose-300 text-rose-800', dot: 'bg-rose-500' },
  arriving_not_ready: { label: 'Arriving · not ready', tone: 'bg-red-50 border-red-300 text-red-800', dot: 'bg-red-500' },
  departing: { label: 'Departing', tone: 'bg-orange-50 border-orange-300 text-orange-800', dot: 'bg-orange-500' },
  needs_cleaning: { label: 'Needs cleaning', tone: 'bg-amber-50 border-amber-300 text-amber-800', dot: 'bg-amber-500' },
  cleaning: { label: 'Being cleaned', tone: 'bg-sky-50 border-sky-300 text-sky-800', dot: 'bg-sky-500' },
  arriving_ready: { label: 'Arriving · ready', tone: 'bg-emerald-50 border-emerald-300 text-emerald-800', dot: 'bg-emerald-500' },
  occupied: { label: 'Guest in house', tone: 'bg-indigo-50 border-indigo-200 text-indigo-800', dot: 'bg-indigo-500' },
  vacant: { label: 'Vacant · clean', tone: 'bg-white border-gray-200 text-gray-700', dot: 'bg-gray-300' },
  maintenance: { label: 'Maintenance', tone: 'bg-gray-100 border-gray-300 text-gray-600', dot: 'bg-gray-500' },
};
