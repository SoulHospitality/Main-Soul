import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';
import { currency, formatDate } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function OwnerSettlementsAdmin() {
  const qc = useQueryClient();
  const [ownerId, setOwnerId] = useState('');
  const [from, setFrom] = useState(FINANCIAL_EPOCH);
  const [to, setTo] = useState(todayStr());

  const { data: users = [] } = useQuery({
    queryKey: ['users-owners'],
    queryFn: () =>
      api.get('/users').then((r) => (Array.isArray(r.data) ? r.data : []).filter((u) => u.role === 'owner')),
  });

  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['owner-settlements-admin', ownerId],
    queryFn: () =>
      api.get('/owner/settlements', { params: ownerId ? { owner_id: ownerId } : {} }).then((r) => r.data),
    enabled: !!ownerId,
  });

  const { data: payouts = [] } = useQuery({
    queryKey: ['owner-payouts-all'],
    queryFn: () => api.get('/owner/payout-requests/all').then((r) => r.data),
  });

  const generate = useMutation({
    mutationFn: () =>
      api.post('/owner/settlements/generate', {
        owner_id: Number(ownerId),
        period_start: from,
        period_end: to,
      }),
    onSuccess: () => {
      toast.success('Settlement generated');
      qc.invalidateQueries({ queryKey: ['owner-settlements-admin'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Generate failed'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }) => api.patch(`/owner/settlements/${id}`, { status }),
    onSuccess: () => {
      toast.success('Settlement updated');
      qc.invalidateQueries({ queryKey: ['owner-settlements-admin'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  });

  const reviewPayout = useMutation({
    mutationFn: ({ id, status, rejection_reason }) =>
      api.post(`/owner/payout-requests/${id}/review`, { status, rejection_reason }),
    onSuccess: () => {
      toast.success('Payout updated');
      qc.invalidateQueries({ queryKey: ['owner-payouts-all'] });
      qc.invalidateQueries({ queryKey: ['owner-settlements-admin'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Review failed'),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Owner settlements</h1>
        <p className="text-sm text-gray-500">Generate period settlements and review payout requests</p>
      </div>

      <div className="bg-white border rounded-xl p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div className="sm:col-span-2">
          <label className="text-xs text-gray-500">Owner</label>
          <SearchableSelect
            value={ownerId}
            onChange={setOwnerId}
            options={[
              { value: '', label: 'Select owner…' },
              ...users.map((u) => ({
                value: String(u.id),
                label: `${u.full_name || u.username} (#${u.id})`,
              })),
            ]}
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">From</label>
          <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">To</label>
          <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button
          type="button"
          className="btn-primary sm:col-span-4 sm:w-auto"
          disabled={!ownerId || generate.isPending}
          onClick={() => generate.mutate()}
        >
          Generate / refresh settlement
        </button>
      </div>

      {ownerId && (
        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 font-semibold border-b">Settlements</div>
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="px-4 py-3 text-right">Gross</th>
                  <th className="px-4 py-3 text-right">Commission</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      {formatDate(s.period_start)} → {formatDate(s.period_end)}
                    </td>
                    <td className="px-4 py-3 text-right">{currency(s.gross_amount)}</td>
                    <td className="px-4 py-3 text-right">{currency(s.commission_amount)}</td>
                    <td className="px-4 py-3 text-right font-semibold">{currency(s.net_amount)}</td>
                    <td className="px-4 py-3">{s.status}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {s.status === 'open' && (
                        <button
                          className="text-xs text-primary-600"
                          onClick={() => setStatus.mutate({ id: s.id, status: 'ready' })}
                        >
                          Mark ready
                        </button>
                      )}
                      {s.status === 'ready' && (
                        <button
                          className="text-xs text-amber-700"
                          onClick={() => setStatus.mutate({ id: s.id, status: 'disputed' })}
                        >
                          Dispute
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!settlements.length && !isLoading && (
            <p className="p-6 text-center text-gray-400 text-sm">No settlements yet</p>
          )}
        </div>
      )}

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="px-4 py-3 font-semibold border-b">Payout requests</div>
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
                        className="text-xs text-emerald-700"
                        onClick={() => reviewPayout.mutate({ id: p.id, status: 'approved' })}
                      >
                        Approve
                      </button>
                      <button
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
        {!payouts.length && <p className="p-6 text-center text-gray-400 text-sm">No payout requests</p>}
      </div>
    </div>
  );
}
