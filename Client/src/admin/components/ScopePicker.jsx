import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import api from '../api/axios';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';

function Chip({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition ${on ? 'bg-soul-blue text-white ring-soul-blue' : 'bg-white text-slate-600 ring-slate-200 hover:ring-soul-blue/50'}`}
    >
      {children}
    </button>
  );
}

const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * Where a promo code or offer applies. Nothing chosen = every unit.
 * value: { destinations: [], projects: [], unit_ids: [] }
 */
export default function ScopePicker({ value, onChange }) {
  const v = { destinations: value?.destinations || [], projects: value?.projects || [], unit_ids: value?.unit_ids || [] };
  const set = (patch) => onChange({ ...v, ...patch });
  const { destinations, projectsByDestination } = useProjectCatalog();
  const [unitSearch, setUnitSearch] = useState('');

  const { data: units = [] } = useQuery({
    queryKey: ['scope-units'],
    queryFn: () => api.get('/units').then((r) => (Array.isArray(r.data) ? r.data : r.data?.items || [])),
    staleTime: 5 * 60000,
  });
  const byId = useMemo(() => new Map(units.map((u) => [String(u.id), u])), [units]);
  const term = unitSearch.trim().toLowerCase();
  const matches = term
    ? units.filter((u) => `${u.unit_number || ''} ${u.title || ''} ${u.compound || ''}`.toLowerCase().includes(term)).slice(0, 8)
    : [];
  const everywhere = !v.destinations.length && !v.projects.length && !v.unit_ids.length;
  const unitLabel = (u) => [u.unit_number, u.title, u.compound].filter(Boolean).join(' · ');

  return (
    <div className="space-y-3 rounded-xl border border-soul-line bg-slate-50/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">Applies to</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${everywhere ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-soul-blue'}`}>
          {everywhere ? 'Every unit' : 'Only what you pick'}
        </span>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Destinations</p>
        <div className="flex flex-wrap gap-1.5">
          {destinations.map((d) => (
            <Chip key={d} on={v.destinations.includes(d)} onClick={() => set({ destinations: toggle(v.destinations, d) })}>{d}</Chip>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Projects</p>
        <div className="space-y-1.5">
          {destinations.map((d) => (projectsByDestination[d] || []).length ? (
            <div key={d} className="flex flex-wrap items-center gap-1.5">
              <span className="w-24 shrink-0 text-[11px] text-gray-400">{d}</span>
              {(projectsByDestination[d] || []).map((p) => (
                <Chip key={p} on={v.projects.includes(p)} onClick={() => set({ projects: toggle(v.projects, p) })}>{p}</Chip>
              ))}
            </div>
          ) : null)}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Units</p>
        {v.unit_ids.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {v.unit_ids.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-soul-blue px-2.5 py-1 text-xs text-white">
                {byId.get(String(id)) ? unitLabel(byId.get(String(id))) : 'Unit'}
                <button type="button" onClick={() => set({ unit_ids: v.unit_ids.filter((x) => x !== id) })} aria-label="Remove unit">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input className="input !pl-8 text-sm" placeholder="Find a unit by code, name or project" value={unitSearch} onChange={(e) => setUnitSearch(e.target.value)} />
        </label>
        {matches.length ? (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-soul-line bg-white">
            {matches.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  if (!v.unit_ids.includes(u.id)) set({ unit_ids: [...v.unit_ids, u.id] });
                  setUnitSearch('');
                }}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-50"
              >
                {unitLabel(u)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <p className="text-[11px] text-gray-500">Pick nothing to use it on every unit. A unit counts if it is in any destination, project or unit you pick.</p>
    </div>
  );
}
