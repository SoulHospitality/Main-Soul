import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Building2, Briefcase, ExternalLink } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency } from '../utils/formatters';

/**
 * Resale Sales overview — for-sale inventory and recent owner contact requests.
 */
export default function ResaleSales() {
  const { data: units = [], isLoading: loadingUnits } = useQuery({
    queryKey: ['units', 'sale', 'sales-page'],
    queryFn: () =>
      api.get('/units', { params: { listing_type: 'sale' } }).then((r) => r.data),
  });

  const { data: leads = [], isLoading: loadingLeads } = useQuery({
    queryKey: ['acquisition-leads', 'sales-page'],
    queryFn: () => api.get('/acquisition-leads').then((r) => r.data),
  });

  const published = units.filter((u) => u.status === 'published').length;
  const drafts = units.filter((u) => u.status === 'draft').length;
  const websiteLeads = leads.filter((l) => l.source === 'website_host');
  const openLeads = leads.filter((l) => l.stage !== 'live').length;

  if (loadingUnits || loadingLeads) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Sales</h1>
        <p className="mt-1 text-sm text-gray-500">
          For-sale inventory overview and owner contact requests. Resale manages sale units only.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Sale units', value: units.length },
          { label: 'Published', value: published },
          { label: 'Drafts', value: drafts },
          { label: 'Open owner requests', value: openLeads },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link to="/admin/units-for-sale" className="btn-primary inline-flex items-center gap-2 text-sm">
          <Building2 className="h-4 w-4" />
          Manage units
        </Link>
        <Link
          to="/admin/acquisition"
          className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          <Briefcase className="h-4 w-4" />
          Owners requests
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border bg-white">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold text-gray-900">For-sale units</h2>
          </div>
          <div className="divide-y">
            {units.slice(0, 12).map((u) => (
              <div key={u.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-900">{u.name || u.title}</p>
                  <p className="text-xs text-gray-500">
                    {[u.project || u.compound, u.unit_number].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">
                    {u.status}
                    {(u.price_per_night || u.price_fallback) > 0
                      ? ` · ${currency(u.price_per_night || u.price_fallback)}`
                      : ''}
                  </p>
                </div>
                {u.slug && (
                  <a
                    href={`/listings/${u.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-gray-400 hover:text-gray-700"
                    title="Open listing"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
              </div>
            ))}
            {!units.length && (
              <p className="px-4 py-8 text-center text-sm text-gray-400">No for-sale units yet.</p>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-white">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold text-gray-900">Recent owner requests</h2>
            <p className="text-xs text-gray-400">From Become a Host and intake</p>
          </div>
          <div className="divide-y">
            {(websiteLeads.length ? websiteLeads : leads).slice(0, 12).map((l) => (
              <div key={l.id} className="px-4 py-3">
                <p className="font-medium text-gray-900">{l.owner_name || l.title}</p>
                <p className="text-xs text-gray-500">
                  Destination: {l.destination || '—'}
                  {l.property_type ? ` · ${l.property_type}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  {l.owner_phone || '—'}
                  {l.owner_email ? ` · ${l.owner_email}` : ''}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {l.stage}
                  {l.source === 'website_host' ? ' · website' : ''}
                  {l.preferred_contact_time ? ` · ${l.preferred_contact_time}` : ''}
                </p>
              </div>
            ))}
            {!leads.length && (
              <p className="px-4 py-8 text-center text-sm text-gray-400">No owner requests yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
