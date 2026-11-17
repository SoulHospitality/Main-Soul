import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { formatOpsDay } from '../components/OpsDateRangeFilter';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { UNIT_STATES, useUnitBoard } from '../hooks/useOpsDay';

const STATE_ORDER = Object.keys(UNIT_STATES);

/** Every unit at a glance, coloured by where it stands today; urgent states first. */
export function UnitBoardSection({ onOpen, initialRange = 'today' }) {
  const [day, setDay] = useState(initialRange === 'tomorrow' ? 'tomorrow' : 'today');
  const [stateFilter, setStateFilter] = useState('');
  const [project, setProject] = useState('');
  const [search, setSearch] = useState('');
  const { data, isLoading, isError, error } = useUnitBoard(day);

  const items = data?.items || [];
  const counts = data?.counts || {};
  const projects = useMemo(() => [...new Set(items.map((r) => r.project).filter(Boolean))].sort(), [items]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items
      .filter((r) => !stateFilter || r.state === stateFilter)
      .filter((r) => !project || r.project === project)
      .filter((r) => !q || [r.unit_number, r.unit_title, r.guest_name, r.cleaner_name].some((v) => String(v || '').toLowerCase().includes(q)))
      .sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || String(a.unit_number || a.unit_title).localeCompare(String(b.unit_number || b.unit_title), undefined, { numeric: true }));
  }, [items, stateFilter, project, search]);

  const actionTab = (state) =>
    ({ turnover: 'checkouts', departing: 'checkouts', needs_cleaning: 'cleans', cleaning: 'cleans', arriving_not_ready: 'cleans', arriving_ready: 'today' })[state];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 p-1 bg-gray-100 rounded-xl">
          {['today', 'tomorrow'].map((d) => (
            <button key={d} type="button" onClick={() => setDay(d)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize ${day === d ? 'bg-white text-soul-blue shadow-sm' : 'text-gray-600'}`}>
              {d}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[10rem] max-w-xs">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-9 w-full" placeholder="Unit, guest or cleaner" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {projects.length > 1 ? (
          <select className="input w-auto" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setStateFilter('')}
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${!stateFilter ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600'}`}>
          All · {items.length}
        </button>
        {STATE_ORDER.filter((s) => counts[s]).map((s) => (
          <button key={s} type="button" onClick={() => setStateFilter(stateFilter === s ? '' : s)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 ${stateFilter === s ? 'ring-2 ring-soul-blue/40' : ''} ${UNIT_STATES[s].tone}`}>
            <span className={`w-2 h-2 rounded-full ${UNIT_STATES[s].dot}`} />
            {UNIT_STATES[s].label} · {counts[s]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="card p-10 flex justify-center"><LoadingSpinner /></div>
      ) : isError ? (
        <div className="card p-10 text-center text-sm text-red-600">
          Could not load units: {error?.response?.data?.error || error?.message}
        </div>
      ) : !shown.length ? (
        <div className="card p-10 text-center text-sm text-gray-500">No units match.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2.5">
          {shown.map((r) => {
            const st = UNIT_STATES[r.state] || UNIT_STATES.vacant;
            const tab = actionTab(r.state);
            return (
              <button key={r.unit_id} type="button" disabled={!tab} onClick={() => tab && onOpen?.(tab, day)}
                className={`rounded-xl border p-3 text-left transition ${st.tone} ${tab ? 'hover:shadow-md' : 'cursor-default'}`}>
                <div className="flex items-center justify-between gap-1">
                  <span className="font-bold text-sm truncate">{r.unit_number || r.unit_title}</span>
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                </div>
                <div className="text-[11px] opacity-75 truncate">{r.project || '—'}</div>
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide">{st.label}</div>
                <div className="text-xs truncate mt-0.5">
                  {r.state === 'turnover' && r.departing_guest
                    ? `${r.departing_guest} → ${r.guest_name || 'Guest'}`
                    : r.state === 'occupied' && r.check_out
                    ? `${r.guest_name || 'Guest'} · out ${formatOpsDay(r.check_out)}`
                    : r.guest_name
                      ? r.guest_name
                      : r.next_check_in
                        ? `Next in ${formatOpsDay(r.next_check_in)}`
                        : 'No upcoming booking'}
                </div>
                {r.cleaner_name && ['needs_cleaning', 'cleaning', 'arriving_not_ready', 'turnover'].includes(r.state) ? (
                  <div className="text-[11px] opacity-75 truncate">Cleaner: {r.cleaner_name}</div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default UnitBoardSection;
