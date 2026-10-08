import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';

/** Live USD → EGP rate from the server (same value the server books USD reservations at). */
export function useLiveUsdRate(enabled = true) {
  return useQuery({
    queryKey: ['live-usd-rate'],
    queryFn: () => api.get('/exchange-rate/usd').then((r) => r.data),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: enabled ? 10 * 60 * 1000 : false,
    retry: 2,
  });
}
