import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  Copy,
  Link2,
  Plug,
  RefreshCw,
  Unplug,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import Modal from '../components/ui/Modal';

const PLATFORMS = [
  { id: 'airbnb', label: 'Airbnb' },
  { id: 'booking', label: 'Booking.com' },
];

const STATUS_STYLES = {
  connected: 'bg-emerald-100 text-emerald-800',
  syncing: 'bg-sky-100 text-sky-800',
  failed: 'bg-rose-100 text-rose-800',
  disconnected: 'bg-stone-100 text-stone-600',
};

function unitCode(unit) {
  return unit.unit_number || unit.slug || unit.title || '—';
}

function feedFor(unit, platformId) {
  return (unit.feeds || []).find((f) => f.platform === platformId && f.ical_url) || null;
}

function formatWhen(value) {
  if (!value) return 'Never';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function StatusBadge({ status }) {
  const key = STATUS_STYLES[status] ? status : 'disconnected';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLES[key]}`}>
      {key}
    </span>
  );
}

function UnitDetailsModal({ unit, open, onClose, focusPlatform }) {
  const qc = useQueryClient();
  const [urls, setUrls] = useState({});
  const [listings, setListings] = useState({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextUrls = {};
    const nextListings = {};
    for (const p of PLATFORMS) {
      const feed = feedFor(unit, p.id);
      nextUrls[p.id] = feed?.ical_url || '';
      nextListings[p.id] = feed?.external_listing_id || '';
    }
    setUrls(nextUrls);
    setListings(nextListings);
    setCopied(false);
  }, [open, unit]);

  async function copySoulLink() {
    if (!unit.export_url) {
      toast.error('Publish this unit to generate a calendar link');
      return;
    }
    try {
      await navigator.clipboard.writeText(unit.export_url);
      setCopied(true);
      toast.success('Soul export calendar copied — paste into the channel’s import calendar');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  }

  async function saveAll() {
    setSaving(true);
    try {
      for (const p of PLATFORMS) {
        const next = (urls[p.id] || '').trim();
        const listing = (listings[p.id] || '').trim();
        const current = feedFor(unit, p.id);
        const currentUrl = current?.ical_url || '';
        const currentListing = current?.external_listing_id || '';
        if (next === currentUrl && listing === currentListing) continue;
        if (!next) {
          if (currentUrl) await api.delete(`/ota-calendar/${unit.id}/${p.id}`);
          continue;
        }
        await api.put(`/ota-calendar/${unit.id}/${p.id}`, {
          ical_url: next,
          external_listing_id: listing || null,
          enabled: true,
        });
      }
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      qc.invalidateQueries({ queryKey: ['ota-calendar'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      toast.success('Channel mapping saved');
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Could not save channel');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={unitCode(unit)}
      size="lg"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="btn-primary" disabled={saving} onClick={saveAll}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {unit.title ? <p className="text-sm text-soul-muted">{unit.title}</p> : null}

        <div className="rounded-2xl border border-dashed border-soul-line bg-[#f7f9fc] p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-soul-blue">
            <Link2 className="w-4 h-4" />
            Soul export calendar (PMS → Channel)
          </div>
          <p className="text-xs text-soul-muted">
            Paste this into the channel’s “import calendar” so their inventory blocks when Soul has a
            booking or schedule hold. iCal does not push rates or restrictions.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              className="input font-mono text-xs flex-1"
              readOnly
              value={unit.export_url || 'Publish this unit to generate a link'}
            />
            <button
              type="button"
              className="btn-primary shrink-0"
              disabled={!unit.export_url}
              onClick={copySoulLink}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <p className="text-sm font-semibold text-soul-blue">Import calendars (Channel → PMS)</p>
          <p className="text-xs text-soul-muted -mt-2">
            Map each external listing explicitly — names often differ. Connection type for these
            channels is iCal (availability only).
          </p>
          {PLATFORMS.map((p) => {
            const feed = feedFor(unit, p.id);
            return (
              <div key={p.id} className="rounded-xl border border-soul-line p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="label mb-0">{p.label}</label>
                  <StatusBadge status={feed?.status || (urls[p.id] ? 'disconnected' : 'disconnected')} />
                </div>
                <input
                  className="input font-mono text-xs"
                  value={urls[p.id] || ''}
                  onChange={(e) => setUrls((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder={`${p.label} iCal export URL (https://…)`}
                  disabled={saving}
                  autoFocus={focusPlatform === p.id}
                />
                <input
                  className="input text-xs"
                  value={listings[p.id] || ''}
                  onChange={(e) => setListings((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="External listing / room ID (optional mapping label)"
                  disabled={saving}
                />
                {feed?.last_sync_at || feed?.last_sync_error ? (
                  <p className="text-[11px] text-soul-muted">
                    Last sync: {formatWhen(feed.last_sync_at)}
                    {feed.last_sync_error ? (
                      <span className="text-rose-600"> — {feed.last_sync_error}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}

export default function CalendarSync() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [focusPlatform, setFocusPlatform] = useState(null);
  const [tab, setTab] = useState('units');

  const { data, isLoading } = useQuery({
    queryKey: ['channel-manager'],
    queryFn: () => api.get('/channel-manager/overview').then((r) => r.data),
  });

  const { data: logsData, isLoading: logsLoading } = useQuery({
    queryKey: ['channel-manager-logs'],
    queryFn: () => api.get('/channel-manager/sync-logs?limit=40').then((r) => r.data),
    enabled: tab === 'logs',
  });

  const units = data?.units || [];
  const providers = data?.providers || [];
  const apiConnections = data?.connections?.api || [];

  const refreshAllMutation = useMutation({
    mutationFn: () => api.post('/channel-manager/sync', {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      qc.invalidateQueries({ queryKey: ['channel-manager-logs'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      const errCount = res.data?.errors || 0;
      if (errCount > 0) {
        toast.error(`Sync finished with ${errCount} error${errCount === 1 ? '' : 's'}`);
      } else {
        toast.success('Channel sync complete');
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Sync failed'),
  });

  const syncFeedMutation = useMutation({
    mutationFn: (feedId) => api.post('/channel-manager/sync', { feed_id: feedId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['channel-manager'] });
      qc.invalidateQueries({ queryKey: ['channel-manager-logs'] });
      if (res.data?.ok === false) toast.error(res.data.error || 'Sync failed');
      else toast.success('Feed synced');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Sync failed'),
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

  const failedFeeds = useMemo(
    () =>
      (Array.isArray(units) ? units : []).flatMap((u) =>
        (u.feeds || [])
          .filter((f) => f.status === 'failed' || f.last_sync_error)
          .map((f) => ({ ...f, unit: u }))
      ),
    [units]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Channel Manager</h1>
          <p className="page-subtitle">
            Central sync for OTAs. iCal is a limited availability fallback — API providers can add
            rates, reservations, and cancellations when credentials are configured.
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={refreshAllMutation.isPending}
          onClick={() => refreshAllMutation.mutate()}
        >
          <RefreshCw className={`w-4 h-4 ${refreshAllMutation.isPending ? 'animate-spin' : ''}`} />
          Sync now
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {[
          { id: 'units', label: 'Unit mapping' },
          { id: 'providers', label: 'Providers' },
          { id: 'logs', label: 'Sync logs' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-sm font-medium border ${
              tab === t.id
                ? 'border-soul-blue bg-soul-blue text-white'
                : 'border-soul-line bg-white text-soul-blue'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {failedFeeds.length > 0 && tab === 'units' ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{failedFeeds.length} connection(s) failed</p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {failedFeeds.slice(0, 5).map((f) => (
                <li key={f.id}>
                  {unitCode(f.unit)} · {f.platform}: {f.last_sync_error || 'Failed'}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {tab === 'providers' ? (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {providers.map((p) => (
              <div key={p.key} className="rounded-2xl border border-soul-line bg-white p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-soul-blue">{p.label}</p>
                  <span className="text-[11px] uppercase tracking-wide text-soul-muted">
                    {p.connection_type}
                  </span>
                </div>
                <p className="text-xs text-soul-muted">
                  {p.configured
                    ? 'Ready to use.'
                    : 'API stub — connect credentials later. Use iCal for availability until then.'}
                </p>
                <p className="text-[11px] text-soul-muted">
                  Capabilities: {(p.capabilities || []).join(', ') || 'none'}
                </p>
              </div>
            ))}
          </div>
          {apiConnections.length > 0 ? (
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <div className="px-4 py-2.5 border-b border-soul-line text-[11px] uppercase tracking-wider text-soul-muted font-semibold">
                API connections
              </div>
              <ul className="divide-y divide-soul-line">
                {apiConnections.map((c) => (
                  <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-soul-blue">{c.display_name}</p>
                      <p className="text-xs text-soul-muted">
                        Last sync: {formatWhen(c.last_sync_at)}
                        {c.last_sync_error ? ` — ${c.last_sync_error}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-soul-muted">
              No API connections yet. Add Booking.com / Airbnb API credentials when available; until
              then configure iCal per unit under Unit mapping.
            </p>
          )}
        </div>
      ) : null}

      {tab === 'logs' ? (
        logsLoading ? (
          <div className="py-16 flex justify-center">
            <LoadingSpinner />
          </div>
        ) : (logsData?.logs || []).length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No sync logs yet"
            description="Run Sync now to pull channel availability and write logs."
          />
        ) : (
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <ul className="divide-y divide-soul-line">
              {(logsData?.logs || []).map((log) => (
                <li key={log.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-soul-blue">
                      {log.provider_key} · {log.operation}
                    </p>
                    <StatusBadge
                      status={
                        log.status === 'success'
                          ? 'connected'
                          : log.status === 'error'
                            ? 'failed'
                            : 'syncing'
                      }
                    />
                  </div>
                  <p className="text-xs text-soul-muted mt-1">
                    {formatWhen(log.created_at)} · {log.direction}
                    {log.message ? ` — ${log.message}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )
      ) : null}

      {tab === 'units' ? (
        <>
          <SearchFilter value={search} onChange={setSearch} placeholder="Search units…" />

          {isLoading ? (
            <div className="py-16 flex justify-center">
              <LoadingSpinner />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Link2}
              title="No published units"
              description="Publish rental units to map channels."
            />
          ) : (
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1.1fr))] gap-2 px-4 py-2.5 border-b border-soul-line bg-[#f7f9fc] text-[11px] uppercase tracking-wider text-soul-muted font-semibold">
                <div>Unit</div>
                {PLATFORMS.map((p) => (
                  <div key={p.id} className="text-center">
                    {p.label}
                  </div>
                ))}
              </div>
              <ul className="divide-y divide-soul-line">
                {filtered.map((unit) => (
                  <li key={unit.id}>
                    <div className="grid grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1.1fr))] gap-2 items-center px-4 py-3 hover:bg-soul-blue-50/40">
                      <button type="button" onClick={() => openUnit(unit)} className="text-left min-w-0">
                        <p className="font-medium text-soul-blue truncate">{unitCode(unit)}</p>
                        {unit.title && unit.title !== unitCode(unit) ? (
                          <p className="text-xs text-soul-muted truncate">{unit.title}</p>
                        ) : null}
                      </button>
                      {PLATFORMS.map((p) => {
                        const feed = feedFor(unit, p.id);
                        return (
                          <div key={p.id} className="flex flex-col items-center gap-1.5 py-1">
                            <button type="button" onClick={() => openUnit(unit, p.id)}>
                              {feed ? (
                                <StatusBadge status={feed.status || 'disconnected'} />
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-soul-muted">
                                  <Unplug className="w-3 h-3" /> Unlinked
                                </span>
                              )}
                            </button>
                            {feed?.id ? (
                              <button
                                type="button"
                                className="text-[11px] text-soul-blue hover:underline"
                                disabled={syncFeedMutation.isPending}
                                onClick={() => syncFeedMutation.mutate(feed.id)}
                              >
                                Sync
                              </button>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : null}

      {liveSelected && (
        <UnitDetailsModal
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
