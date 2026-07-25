import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency, formatDate } from '../utils/formatters';

export default function OwnerSettlementsAdmin() {
  const qc = useQueryClient();

  const { data: payouts = [], isLoading } = useQuery({
    queryKey: ['owner-payouts-all'],
    queryFn: () => api.get('/owner/payout-requests/all').then((r) => r.data),
  });

  const reviewPayout = useMutation({
    mutationFn: ({ id, status, rejection_reason }) =>
      api.post(`/owner/payout-requests/${id}/review`, { status, rejection_reason }),
    onSuccess: () => {
      toast.success('Withdrawal request updated');
      qc.invalidateQueries({ queryKey: ['owner-payouts-all'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Review failed'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Owner settlements</h1>
        <p className="text-sm text-gray-500">Review owner withdrawal requests</p>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-4 py-3 font-semibold border-b">Withdrawal requests</div>
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Owner</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {payouts.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">{p.owner_name || p.owner_username}</td>
                  <td className="px-4 py-3 text-right">{currency(p.amount)}</td>
                  <td className="px-4 py-3">{p.status}</td>
                  <td className="px-4 py-3">{formatDate(p.created_at)}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {p.status === 'requested' && (
                      <>
                        <button
                          type="button"
                          className="text-xs text-emerald-700"
                          onClick={() => reviewPayout.mutate({ id: p.id, status: 'approved' })}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-600"
                          onClick={() =>
                            reviewPayout.mutate({
                              id: p.id,
                              status: 'rejected',
                              rejection_reason: 'Rejected by finance',
                            })
                          }
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {p.status === 'approved' && (
                      <button
                        type="button"
                        className="text-xs text-primary-600"
                        onClick={() => reviewPayout.mutate({ id: p.id, status: 'paid' })}
                      >
                        Mark paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isLoading && !payouts.length && (
          <p className="p-6 text-center text-gray-400 text-sm">No withdrawal requests</p>
        )}
      </div>
    </div>
  );
}
