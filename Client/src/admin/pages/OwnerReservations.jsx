import { useQuery } from '@tanstack/react-query';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency, formatDate } from '../utils/formatters';
import Badge from '../components/ui/Badge';

export default function OwnerReservations() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['owner-reservations'],
    queryFn: () => api.get('/owner/reservations').then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Reservations</h1>
        <p className="text-sm text-gray-500">Dates and amounts only — guest identity is never shown</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        {!data.length ? (
          <p className="p-8 text-center text-gray-400 text-sm">No reservations yet</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Ref</th>
                <th className="px-4 py-3 text-left">Unit</th>
                <th className="px-4 py-3 text-left">Dates</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Commission</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data.map((r) => (
                <tr key={r.booking_ref}>
                  <td className="px-4 py-3 font-mono text-xs">{r.booking_ref}</td>
                  <td className="px-4 py-3">{r.unit_name}</td>
                  <td className="px-4 py-3">
                    {formatDate(r.check_in)} → {formatDate(r.check_out)}
                  </td>
                  <td className="px-4 py-3 text-right">{currency(r.gross)}</td>
                  <td className="px-4 py-3 text-right">{currency(r.commission)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{currency(r.net)}</td>
                  <td className="px-4 py-3">
                    <Badge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
