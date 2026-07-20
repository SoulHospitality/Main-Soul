import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';

export default function MaintenanceTickets() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [unitId, setUnitId] = useState('');
  const [severity, setSeverity] = useState('medium');

  const { data: units = [] } = useQuery({
    queryKey: ['units-list'],
    queryFn: () => api.get('/units').then((r) => (Array.isArray(r.data) ? r.data : r.data?.items || [])),
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['maintenance-tickets'],
    queryFn: () => api.get('/maintenance-tickets').then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: () => api.post('/maintenance-tickets', { title, unit_id: unitId, severity }),
    onSuccess: () => {
      toast.success('Ticket created');
      setTitle('');
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const resolve = useMutation({
    mutationFn: (id) => api.patch(`/maintenance-tickets/${id}`, { status: 'resolved' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-tickets'] });
      toast.success('Resolved');
    },
  });

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Maintenance</h1>
        <p className="text-sm text-gray-500">Ticket log scaffold (Phase 1–2)</p>
      </div>

      <div className="bg-white border rounded-xl p-4 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
        <div className="sm:col-span-2">
          <label className="text-xs text-gray-500">Title</label>
          <input className="w-full border rounded-lg px-3 py-2 text-sm" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">Unit</label>
          <SearchableSelect
            value={unitId}
            onChange={setUnitId}
            options={units.map((u) => ({ value: String(u.id), label: u.name || u.title || u.unit_number }))}
            placeholder="Select unit"
          />
        </div>
        <div className="flex gap-2">
          <select className="border rounded-lg px-2 py-2 text-sm" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            {['low', 'medium', 'high', 'urgent'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            className="btn-primary"
            disabled={!title || !unitId || create.isPending}
            onClick={() => create.mutate()}
          >
            Create
          </button>
        </div>
      </div>

      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Unit</th>
              <th className="px-4 py-3 text-left">Title</th>
              <th className="px-4 py-3 text-left">Severity</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.map((t) => (
              <tr key={t.id}>
                <td className="px-4 py-3">{t.unit_name}</td>
                <td className="px-4 py-3 font-medium">{t.title}</td>
                <td className="px-4 py-3">{t.severity}</td>
                <td className="px-4 py-3">{t.status}</td>
                <td className="px-4 py-3 text-right">
                  {t.status !== 'resolved' && t.status !== 'closed' && (
                    <button className="text-xs text-primary-600" onClick={() => resolve.mutate(t.id)}>
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.length && <p className="p-6 text-center text-gray-400 text-sm">No tickets</p>}
      </div>
    </div>
  );
}
