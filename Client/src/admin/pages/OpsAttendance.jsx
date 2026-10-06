import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import Modal from '../components/ui/Modal';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../utils/formatters';
import { CameraPhotoField } from '../components/CameraCapture';

function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

function currentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
}

function ClockModal({ kind, onClose }) {
  const qc = useQueryClient();
  const [photo, setPhoto] = useState(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('photo', photo);
      const pos = await currentPosition();
      if (pos) {
        fd.append('lat', String(pos.lat));
        fd.append('lng', String(pos.lng));
      }
      return api.post('/ops/attendance', fd);
    },
    onSuccess: () => {
      toast.success(kind === 'in' ? 'Clocked in' : 'Clocked out');
      qc.invalidateQueries({ queryKey: ['ops-attendance'] });
      setPhoto(null);
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not record attendance'),
  });
  return (
    <Modal
      open={!!kind}
      onClose={onClose}
      title={kind === 'in' ? 'Clock in' : 'Clock out'}
      size="sm"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!photo || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Confirm'}
          </button>
        </>
      }
    >
      <CameraPhotoField label="Selfie" required facing="user" file={photo} onChange={setPhoto} />
    </Modal>
  );
}

export function AttendanceSection() {
  const { user } = useAuth();
  const isSupervisor = user?.role === 'admin' || user?.role === 'operations_supervisor';
  const canClock = user?.role === 'operations' || user?.role === 'operations_supervisor';
  const [from, setFrom] = useState(cairoToday());
  const [to, setTo] = useState(cairoToday());
  const [staffId, setStaffId] = useState('');
  const [clockKind, setClockKind] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['ops-attendance', from, to, staffId],
    queryFn: async () =>
      (await api.get('/ops/attendance', { params: { from, to, staff_id: staffId || undefined } })).data,
  });
  const { data: agents = [] } = useQuery({
    queryKey: ['ops-agents'],
    queryFn: async () => {
      const r = await api.get('/ops/agents');
      return Array.isArray(r.data) ? r.data : [];
    },
    enabled: isSupervisor,
  });
  const items = data?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs space-y-1">
            <span className="text-gray-500">From</span>
            <input type="date" className="input text-sm py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="text-xs space-y-1">
            <span className="text-gray-500">To</span>
            <input type="date" className="input text-sm py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {isSupervisor ? (
            <label className="text-xs space-y-1">
              <span className="text-gray-500">Agent</span>
              <select className="input text-sm py-1.5" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Everyone</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name || a.username}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {canClock ? (
          <div className="flex gap-2">
            <button type="button" className="btn-primary text-sm" onClick={() => setClockKind('in')}>
              <LogIn className="w-4 h-4" /> Clock in
            </button>
            <button type="button" className="btn-secondary text-sm" onClick={() => setClockKind('out')}>
              <LogOut className="w-4 h-4" /> Clock out
            </button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="card p-8 text-center text-sm text-red-600">
          {error?.response?.data?.error || 'Could not load attendance'}
        </div>
      ) : !items.length ? (
        <div className="card p-8 text-center text-sm text-gray-500">No attendance records in this period.</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b">
              <tr>
                <th className="py-3 px-4">Photo</th>
                <th className="py-3 px-4">Agent</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Time</th>
                <th className="py-3 px-4">Location</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2 px-4">
                    <a href={a.photo_url} target="_blank" rel="noreferrer">
                      <img src={a.photo_url} alt="" className="h-12 w-12 rounded-lg object-cover border" />
                    </a>
                  </td>
                  <td className="py-2 px-4 font-medium text-gray-900">{a.staff_name}</td>
                  <td className="py-2 px-4">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        a.kind === 'in' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {a.kind === 'in' ? 'In' : 'Out'}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-gray-600">{formatDateTime(a.created_at)}</td>
                  <td className="py-2 px-4 text-xs">
                    {a.lat != null && a.lng != null ? (
                      <a
                        href={`https://maps.google.com/?q=${a.lat},${a.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-soul-blue underline"
                      >
                        Map
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ClockModal kind={clockKind} onClose={() => setClockKind(null)} />
    </div>
  );
}
