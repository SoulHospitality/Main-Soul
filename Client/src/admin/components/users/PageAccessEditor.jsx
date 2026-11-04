import { useMemo, useState } from 'react';
import { ChevronDown, RotateCcw, Search, ShieldCheck } from 'lucide-react';
import { canAccess, hasPermission } from '../../utils/permissions';
import {
  FIXED_ACCESS_ROLES,
  LEVEL_LABELS,
  PAGE_GROUPS,
  SCOPE_HINTS,
  SCOPE_LABELS,
} from '../../utils/pageCatalog';

const READ_ONLY_BY_ROLE = {
  marketing_pr: ['reservations', 'units', 'schedule'],
  hr: ['reservations', 'units'],
  hr_supervisor: ['reservations', 'units'],
  finance: ['reservations', 'units', 'schedule'],
  finance_manager: ['reservations', 'units', 'schedule'],
  owners_relations: ['reservations', 'schedule'],
};

const TEAM_ROLES = new Set(['reservations_manager', 'hr_supervisor', 'unit_acquisition_manager', 'operations_supervisor', 'resale_manager']);
const ROLE_RULE_RESERVATION_ROLES = new Set(['finance', 'finance_manager', 'operations', 'operations_supervisor']);

function defaultScope(role, key) {
  if (key === 'reservations') {
    if (role === 'owners_relations') return 'all';
    if (ROLE_RULE_RESERVATION_ROLES.has(role)) return 'role';
    return TEAM_ROLES.has(role) ? 'team' : 'own';
  }
  if (key === 'website_bookings') {
    if (role === 'reservations_manager') return 'team';
    return role === 'reservations_manual' ? 'role' : 'own';
  }
  if (key === 'audit_log') return 'team';
  return undefined;
}

/** What the role gets today, expressed as a page map (used to pre-fill a custom set). */
export function roleDefaultPageAccess(role) {
  const asRole = { role };
  const out = {};
  for (const group of PAGE_GROUPS) {
    for (const page of group.pages) {
      if (!canAccess(asRole, page.key)) continue;
      let level = page.levels.includes('write') ? 'write' : 'read';
      const readOnly =
        READ_ONLY_BY_ROLE[role]?.includes(page.key) ||
        (hasPermission(asRole, `${page.key}:read`) && !hasPermission(asRole, `${page.key}:write`));
      if (readOnly) level = 'read';
      const entry = { level };
      if (page.scopes) entry.scope = defaultScope(role, page.key) || page.scopes[0];
      out[page.key] = entry;
    }
  }
  return out;
}

function Segmented({ options, value, onChange, labels, disabled }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          role="radio"
          aria-checked={value === opt}
          disabled={disabled}
          onClick={() => onChange(opt)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === opt ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-soul-blue'
          }`}
        >
          {labels[opt] || opt}
        </button>
      ))}
    </div>
  );
}

function PageRow({ page, entry, onChange }) {
  const on = Boolean(entry);
  const toggle = () => {
    if (on) return onChange(null);
    const next = { level: page.levels.includes('write') ? 'write' : 'read' };
    if (page.scopes) next.scope = page.scopes.includes('own') ? 'own' : page.scopes[0];
    return onChange(next);
  };
  const hint = on && page.scopes ? SCOPE_HINTS[page.key]?.[entry.scope] : null;

  return (
    <li className={`px-3 py-2.5 ${on ? 'bg-white' : 'bg-slate-50/60'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex min-w-[11rem] flex-1 cursor-pointer items-center gap-2.5">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-soul-blue" checked={on} onChange={toggle} />
          <span className={`text-sm ${on ? 'font-medium text-soul-blue' : 'text-slate-500'}`}>{page.label}</span>
        </label>
        {on ? (
          <div className="flex flex-wrap items-center gap-2">
            {page.levels.length > 1 ? (
              <Segmented
                options={page.levels}
                value={entry.level}
                labels={LEVEL_LABELS}
                onChange={(level) => onChange({ ...entry, level })}
              />
            ) : (
              <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Read only</span>
            )}
            {page.scopes ? (
              <Segmented
                options={page.scopes}
                value={entry.scope}
                labels={SCOPE_LABELS}
                onChange={(scope) => onChange({ ...entry, scope })}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {hint ? <p className="mt-1.5 ps-[26px] text-[11px] text-slate-400">{hint}</p> : null}
    </li>
  );
}

/**
 * CEO-only editor for one staff member's pages. `value` null = follow the role;
 * an object = this exact set of pages (anything unticked is hidden and blocked by the server).
 */
export default function PageAccessEditor({ role, value, onChange }) {
  const [filter, setFilter] = useState('');
  const [openGroups, setOpenGroups] = useState(() => new Set(PAGE_GROUPS.map((g) => g.id)));
  const custom = value && typeof value === 'object' ? value : null;
  const defaults = useMemo(() => roleDefaultPageAccess(role), [role]);
  const shown = custom || defaults;

  if (FIXED_ACCESS_ROLES.has(role)) {
    return (
      <section className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
        <h3 className="mb-1 flex items-center gap-2 font-semibold text-soul-blue">
          <ShieldCheck className="h-4 w-4" /> Page access
        </h3>
        {role === 'admin' ? 'The CEO always has full access to every page.' : 'Owners use the owner portal pages.'}
      </section>
    );
  }

  const setPage = (key, entry) => {
    const next = { ...shown };
    if (entry) next[key] = entry;
    else delete next[key];
    onChange(next);
  };

  const setGroup = (group, enable) => {
    const next = { ...shown };
    for (const page of group.pages) {
      if (enable && !next[page.key]) {
        next[page.key] = defaults[page.key] || {
          level: page.levels.includes('write') ? 'write' : 'read',
          ...(page.scopes ? { scope: page.scopes.includes('own') ? 'own' : page.scopes[0] } : {}),
        };
      }
      if (!enable) delete next[page.key];
    }
    onChange(next);
  };

  const term = filter.trim().toLowerCase();
  const enabledCount = Object.keys(shown).length;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-semibold text-soul-blue">
            <ShieldCheck className="h-4 w-4" /> Page access
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {custom
              ? `Custom for this person · ${enabledCount} page${enabledCount === 1 ? '' : 's'}. Unticked pages are hidden and blocked.`
              : 'Following the role. Change anything below to give this person their own access.'}
          </p>
        </div>
        {custom ? (
          <button type="button" onClick={() => onChange(null)} className="btn-secondary inline-flex items-center gap-1.5 !px-3 !py-1.5 text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Use role defaults
          </button>
        ) : null}
      </div>

      <label className="relative block">
        <span className="sr-only">Find a page</span>
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input w-full !ps-9" placeholder="Find a page…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </label>

      <div className="space-y-2">
        {PAGE_GROUPS.map((group) => {
          const pages = term ? group.pages.filter((p) => p.label.toLowerCase().includes(term)) : group.pages;
          if (!pages.length) return null;
          const count = group.pages.filter((p) => shown[p.key]).length;
          const open = term || openGroups.has(group.id);
          return (
            <div key={group.id} className="overflow-hidden rounded-lg border border-slate-200">
              <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-start text-sm font-semibold text-soul-blue"
                  onClick={() =>
                    setOpenGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  aria-expanded={Boolean(open)}
                >
                  <ChevronDown className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
                  {group.label}
                  <span className="text-xs font-normal text-slate-400">
                    {count}/{group.pages.length}
                  </span>
                </button>
                <div className="flex gap-2 text-xs">
                  <button type="button" className="font-medium text-soul-blue hover:underline" onClick={() => setGroup(group, true)}>
                    All
                  </button>
                  <button type="button" className="text-slate-500 hover:underline" onClick={() => setGroup(group, false)}>
                    None
                  </button>
                </div>
              </div>
              {open ? (
                <ul className="divide-y divide-slate-100">
                  {pages.map((page) => (
                    <PageRow key={page.key} page={page} entry={shown[page.key]} onChange={(entry) => setPage(page.key, entry)} />
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400">
        Profile and notifications always stay available. Inbox pages also need the person on the Inbox team.
      </p>
    </section>
  );
}
