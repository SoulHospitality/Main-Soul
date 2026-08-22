import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, RefreshCw, Check, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import { formatDateTime } from '../utils/formatters';

const PLATFORMS = [
  { id: 'airbnb', label: 'Airbnb', hint: 'Airbnb → Availability → Calendar sync → Export calendar' },
  { id: 'booking', label: 'Booking.com', hint: 'Booking.com → Rates & Availability → Calendar sync → Export' },
  { id: 'travigo', label: 'Travigo / Trivago', hint: 'Paste the export calendar link from the channel' },
  { id: 'other', label: 'Other channel', hint: 'Any other booking site that provides an iCal export URL' },
];

function feedForPlatform(feeds, platform) {
  return (feeds || []).find((f) => f.platform === platform) || null;
}

function SyncStatus({ feed }) {
  if (!feed?.ical_url) return null;
  if (feed.last_sync_error) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-rose-600">
        <AlertCircle className="w-3.5 h-3.5" />
        Sync failed
      </span>
    );
  }
  if (feed.last_sync_at) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
        <Check className="w-3.5 h-3.5" />
        Synced {formatDateTime(feed.last_sync_at)}
      </span>
    );
  }
  return <span className="text-xs text-soul-muted">Not synced yet</span>;
}

function PlatformRow({ unitId, platform, feed, onSaved }) {
  const [url, setUrl] = useState(feed?.ical_url || '');
  const [label, setLabel] = useState(feed?.label || '');

  useEffect(() => {
    setUrl(feed?.ical_url || '');
    setLabel(feed?.label || '');
  }, [feed?.ical_url, feed?.label, feed?.updated_at]);

  const saveMutation = useMutation({
    mutationFn: (payload) => api.put(`/ota-calendar/${unitId}/${platform.id}`, payload),
    onSuccess: (res) => {
      onSaved(res.data);
      toast.success(`${platform.label} calendar saved`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save calendar'),
  });

  const clearMutation = useMutation({
    mutationFn: () => api.delete(`/ota-calendar/${unitId}/${platform.id}`),
    onSuccess: () => {
      setUrl('');
      setLabel('');
      onSaved({ cleared: true, platform: platform.id });
      toast.success(`${platform.label} calendar removed`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not remove calendar'),
  });

  const busy = saveMutation.isPending || clearMutation.isPending;

  return (
    <div className="rounded-xl border border-soul-line bg-white p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-soul-blue">{platform.label}</p>
          <p className="text-xs text-soul-muted mt-0.5">{platform.hint}</p>
        </div>
        <SyncStatus feed={feed} />
      </div>

      {platform.id === 'other' && (
        <div>
          <label className="label">Channel name (optional)</label>
          <input
            className="input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Expedia"
            disabled={busy}
          />
        </div>
      )}

      <div>
        <label className="label">Import calendar URL</label>
        <input
          className="input font-mono text-xs"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          disabled={busy}
        />
        <p className="text-[11px] text-soul-muted mt-1">
          Paste the export link from {platform.label}. Blocked nights appear on Schedule and your website.
        </p>
      </div>

      {feed?.last_sync_error && (
        <p className="text-xs text-rose-600 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">
          {feed.last_sync_error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || !url.trim()}
          onClick={() => saveMutation.mutate({ ical_url: url.trim(), label: label.trim() || null })}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save & sync'}
        </button>
        {feed?.ical_url && (
          <button
            type="button"
            className="btn-secondary text-rose-700 border-rose-200 hover:bg-rose-50"
            disabled={busy}
            onClick={() => clearMutation.mutate()}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function UnitCard({ unit, onRefreshUnit }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);

  const copyExport = async () => {
    if (!unit.export_url) return;
    try {
      await navigator.clipboard.writeText(unit.export_url);
      setCopied(true);
      toast.success('Export link copied');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  const refreshMutation = useMutation({
    mutationFn: () => api.post('/ota-calendar/refresh', { unit_id: unit.id }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['ota-calendar'] });
      qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
      onRefreshUnit?.(res.data);
      const errCount = res.data?.errors || 0;
      if (errCount > 0) {
        toast.error(`Synced with ${errCount} feed error${errCount === 1 ? '' : 's'}`);
      } else {
        toast.success('Calendar refreshed');
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Refresh failed'),
  });

  const handleFeedSaved = () => {
    qc.invalidateQueries({ queryKey: ['ota-calendar'] });
    qc.invalidateQueries({ queryKey: ['calendar-blocks'] });
  };

  return (
    <section className="card p-5 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-display text-soul-blue">{unit.title}</h2>
          {unit.unit_number && (
            <p className="text-xs text-soul-muted mt-0.5">Unit {unit.unit_number}</p>
          )}
        </div>
        <button
          type="button"
          className="btn-secondary"
          disabled={refreshMutation.isPending}
          onClick={() => refreshMutation.mutate()}
        >
          <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          Refresh unit
        </button>
      </div>

      <div className="rounded-2xl border border-dashed border-soul-line bg-[#f7f9fc] p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-soul-blue">
          <Link2 className="w-4 h-4" />
          Soul export link — paste into Airbnb, Booking.com, etc.
        </div>
        <p className="text-xs text-soul-muted">
          When a guest books on your website (or staff adds a reservation), these blocked nights are sent to
          connected booking sites.
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
            onClick={copyExport}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {PLATFORMS.map((platform) => (
          <PlatformRow
            key={platform.id}
            unitId={unit.id}
            platform={platform}
            feed={feedForPlatform(unit.feeds, platform.id)}
            onSaved={handleFeedSaved}
          />
        ))}
      </div>
    </section>
  );
}

export default function CalendarSync() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

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
        toast.success('All OTA calendars refreshed');
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Calendar sync</h1>
          <p className="page-subtitle max-w-2xl">
            Link Airbnb, Booking.com, and other channels with Soul. Export your Soul calendar to block OTAs
            when you get a website booking. Import each channel&apos;s calendar so their bookings block your
            website and Schedule — each platform is tracked separately.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
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
          description="Publish rental units to set up OTA calendar sync."
        />
      ) : (
        <div className="space-y-6">
          {filtered.map((unit) => (
            <UnitCard key={unit.id} unit={unit} />
          ))}
        </div>
      )}
    </div>
  );
}
