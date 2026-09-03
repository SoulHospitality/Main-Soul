import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Link2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import Modal from '../components/ui/Modal';
import { unitDisplay } from '../utils/formatters';

function unitCode(unit) {
  return unit.unit_number || unit.slug || unit.title || '—';
}

function isLinked(unit) {
  return (unit.feeds || []).some((f) => Boolean(f?.ical_url));
}

function primaryFeed(unit) {
  const feeds = unit.feeds || [];
  return feeds.find((f) => f?.ical_url) || feeds[0] || null;
}

function UnitLinkModal({ unit, open, onClose }) {
  const qc = useQueryClient();
  const feed = primaryFeed(unit);
  const platform = feed?.platform || 'other';
  const [url, setUrl] = useState(feed?.ical_url || '');

  useEffect(() => {
    setUrl(feed?.ical_url || '');
  }, [feed?.ical_url, unit?.id, open]);

  const saveMutation = useMutation({
    mutationFn: (payload) => api.put(`/ota-calendar/${unit.id}/${platform}`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ota-calendar'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      toast.success('Calendar link saved');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save calendar'),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      const feeds = (unit.feeds || []).filter((f) => f?.ical_url && f?.platform);
      if (!feeds.length) {
        await api.delete(`/ota-calendar/${unit.id}/${platform}`);
        return;
      }
      await Promise.all(feeds.map((f) => api.delete(`/ota-calendar/${unit.id}/${f.platform}`)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ota-calendar'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      setUrl('');
      toast.success('Calendar link removed');
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not remove calendar'),
  });

  const busy = saveMutation.isPending || clearMutation.isPending;
  const linked = isLinked(unit);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={unitCode(unit)}
      size="sm"
      footer={
        <>
          {linked && (
            <button
              type="button"
              className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50"
              disabled={busy}
              onClick={() => clearMutation.mutate()}
            >
              Remove
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={busy || !url.trim()}
            onClick={() => saveMutation.mutate({ ical_url: url.trim() })}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-soul-muted">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${linked ? 'bg-emerald-500' : 'bg-rose-500'}`}
          />
          {linked ? 'Linked' : 'Not linked'}
          {unit.title && unit.unit_number ? (
            <span className="truncate">· {unit.title}</span>
          ) : null}
        </div>

        <div>
          <label className="label">Calendar link</label>
          <input
            className="input font-mono text-xs"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            disabled={busy}
            autoFocus
          />
          <p className="text-[11px] text-soul-muted mt-1">
            Paste the export calendar URL from Airbnb, Booking.com, or another channel.
          </p>
        </div>

        {feed?.last_sync_error && (
          <p className="text-xs text-rose-600 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">
            {feed.last_sync_error}
          </p>
        )}
      </div>
    </Modal>
  );
}

export default function CalendarSync() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

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

  const linkedCount = filtered.filter(isLinked).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Calendar sync</h1>
          <p className="page-subtitle">
            {filtered.length
              ? `${linkedCount} linked · ${filtered.length - linkedCount} unlinked`
              : 'Link unit calendars to Airbnb, Booking.com, and other channels.'}
          </p>
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
          <ul className="divide-y divide-soul-line">
            {filtered.map((unit) => {
              const linked = isLinked(unit);
              return (
                <li key={unit.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(unit)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-soul-blue-50/40 transition-colors"
                  >
                    <span
                      className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                        linked ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                      title={linked ? 'Linked' : 'Unlinked'}
                      aria-label={linked ? 'Linked' : 'Unlinked'}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-soul-blue truncate">{unitCode(unit)}</p>
                      {unit.title && unit.unit_number ? (
                        <p className="text-xs text-soul-muted truncate">{unitDisplay(unit)}</p>
                      ) : null}
                    </div>
                    <span className={`text-xs ${linked ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {linked ? 'Linked' : 'Unlinked'}
                    </span>
                    <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selected && (
        <UnitLinkModal
          unit={(Array.isArray(units) ? units : []).find((u) => u.id === selected.id) || selected}
          open={Boolean(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
