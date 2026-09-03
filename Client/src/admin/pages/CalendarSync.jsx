import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import Modal from '../components/ui/Modal';

const PLATFORMS = [
  { id: 'airbnb', label: 'Airbnb' },
  { id: 'booking', label: 'Booking' },
  { id: 'travigo', label: 'Travigo' },
  { id: 'other', label: 'Other' },
];

function unitCode(unit) {
  return unit.unit_number || unit.slug || unit.title || '—';
}

function feedFor(unit, platformId) {
  return (unit.feeds || []).find((f) => f.platform === platformId && f.ical_url) || null;
}

function platformLinked(unit, platformId) {
  return Boolean(feedFor(unit, platformId));
}

function StatusDot({ linked }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full ${linked ? 'bg-emerald-500' : 'bg-rose-500'}`}
      title={linked ? 'Linked' : 'Unlinked'}
      aria-label={linked ? 'Linked' : 'Unlinked'}
    />
  );
}

function UnitLinkModal({ unit, open, onClose, focusPlatform }) {
  const qc = useQueryClient();
  const [urls, setUrls] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next = {};
    for (const p of PLATFORMS) {
      next[p.id] = feedFor(unit, p.id)?.ical_url || '';
    }
    setUrls(next);
  }, [open, unit]);

  async function saveAll() {
    setSaving(true);
    try {
      for (const p of PLATFORMS) {
        const next = (urls[p.id] || '').trim();
        const current = feedFor(unit, p.id)?.ical_url || '';
        if (next === current) continue;
        if (!next) {
          if (current) await api.delete(`/ota-calendar/${unit.id}/${p.id}`);
          continue;
        }
        await api.put(`/ota-calendar/${unit.id}/${p.id}`, { ical_url: next });
      }
      qc.invalidateQueries({ queryKey: ['ota-calendar'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      toast.success('Calendar links saved');
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save calendar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={unitCode(unit)}
      size="md"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={saveAll}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {PLATFORMS.map((p) => {
          const linked = Boolean((urls[p.id] || '').trim());
          return (
            <div key={p.id}>
              <label className="label flex items-center gap-2">
                {p.label}
                <StatusDot linked={linked} />
              </label>
              <input
                className="input font-mono text-xs"
                value={urls[p.id] || ''}
                onChange={(e) => setUrls((prev) => ({ ...prev, [p.id]: e.target.value }))}
                placeholder="https://…"
                disabled={saving}
                autoFocus={focusPlatform === p.id}
              />
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default function CalendarSync() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [focusPlatform, setFocusPlatform] = useState(null);

  const { data: units = [], isLoading } = useQuery({
    queryKey: ['ota-calendar'],
    queryFn: () => api.get('/ota-calendar').then((r) => r.data),
  });

  const refreshAllMutation = useMutation({
    mutationFn: () => api.post('/ota-calendar/refresh'),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['ota-calendar'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      const errCount = res.data?.errors || 0;
      if (errCount > 0) {
        toast.error(`Refresh finished with ${errCount} feed error${errCount === 1 ? '' : 's'}`);
      } else {
        toast.success('Calendars refreshed');
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Refresh failed'),
  });

  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      (Array.isArray(units) ? units : []).filter((u) => {
        if (!q) return true;
        return [u.title, u.unit_number, u.slug].filter(Boolean).join(' ').toLowerCase().includes(q);
      }),
    [units, q]
  );

  function openUnit(unit, platformId = null) {
    setFocusPlatform(platformId);
    setSelected(unit);
  }

  const liveSelected =
    selected && (Array.isArray(units) ? units : []).find((u) => u.id === selected.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Calendar sync</h1>
          <p className="page-subtitle">Green = linked · Red = no calendar URL</p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={refreshAllMutation.isPending}
          onClick={() => refreshAllMutation.mutate()}
        >
          <RefreshCw className={`w-4 h-4 ${refreshAllMutation.isPending ? 'animate-spin' : ''}`} />
          Refresh all
        </button>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search units…" />

      {isLoading ? (
        <div className="py-16 flex justify-center">
          <LoadingSpinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No published units"
          description="Publish rental units to set up calendar sync."
        />
      ) : (
        <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-2 px-4 py-2.5 border-b border-soul-line bg-[#f7f9fc] text-[11px] uppercase tracking-wider text-soul-muted font-semibold">
            <div>Unit code</div>
            {PLATFORMS.map((p) => (
              <div key={p.id} className="text-center">
                {p.label}
              </div>
            ))}
          </div>
          <ul className="divide-y divide-soul-line">
            {filtered.map((unit) => (
              <li key={unit.id}>
                <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-2 items-center px-4 py-3 hover:bg-soul-blue-50/40">
                  <button
                    type="button"
                    onClick={() => openUnit(unit)}
                    className="text-left min-w-0"
                  >
                    <p className="font-medium text-soul-blue truncate">{unitCode(unit)}</p>
                  </button>
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => openUnit(unit, p.id)}
                      className="flex flex-col items-center gap-1.5 py-1"
                    >
                      <span className="sr-only">{p.label}</span>
                      <StatusDot linked={platformLinked(unit, p.id)} />
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {liveSelected && (
        <UnitLinkModal
          unit={liveSelected}
          open
          focusPlatform={focusPlatform}
          onClose={() => {
            setSelected(null);
            setFocusPlatform(null);
          }}
        />
      )}
    </div>
  );
}
