import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import DateRangePicker from '../ui/DateRangePicker';

const isAfterDay = (a, b) => {
  const sa = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const sb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return sa > sb;
};

/**
 * SoulHospitality-style vertical search capsule for the homepage hero.
 * Project + dates + guests → /search.
 */
export default function HeroSearch() {
  const navigate = useNavigate();
  const { projectCards } = useProjectCatalog();
  const capsuleRef = useRef(null);

  const projects = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const p of projectCards) {
      const key = String(p.name || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      list.push(p);
    }
    return list;
  }, [projectCards]);

  const [criteria, setCriteria] = useState({
    project: '',
    destination: '',
    checkin: '',
    checkout: '',
    guests: 1,
  });
  const [projectOpen, setProjectOpen] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);

  useEffect(() => {
    const onOutside = (event) => {
      if (capsuleRef.current && !capsuleRef.current.contains(event.target)) {
        setProjectOpen(false);
        setGuestOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const projectLabel = criteria.project || 'Which project?';

  const hasValidRange =
    criteria.checkin &&
    criteria.checkout &&
    isAfterDay(new Date(`${criteria.checkout}T00:00:00`), new Date(`${criteria.checkin}T00:00:00`));

  function handleSubmit(event) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (criteria.destination) params.set('destination', criteria.destination);
    if (criteria.project) params.set('compound', criteria.project);
    if (criteria.checkin) params.set('checkin', criteria.checkin);
    if (criteria.checkout) params.set('checkout', criteria.checkout);
    if (criteria.guests > 0) params.set('guests', String(criteria.guests));
    navigate(`/search?${params.toString()}`);
  }

  return (
    <form
      ref={capsuleRef}
      onSubmit={handleSubmit}
      className="relative z-[60] flex w-full flex-col gap-4 overflow-visible rounded-[1.6rem] border border-white/25 bg-white/10 p-4 shadow-[0_24px_70px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:gap-5 sm:rounded-[2rem] sm:p-6 lg:p-8"
    >
      {/* Project */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setProjectOpen((o) => !o);
            setGuestOpen(false);
          }}
          className="flex w-full cursor-pointer flex-col gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-left transition-colors hover:bg-white/20"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">
            Project
          </span>
          <span
            className={`truncate text-sm font-medium ${
              criteria.project ? 'text-white' : 'text-white/55'
            }`}
          >
            {projectLabel}
          </span>
        </button>

        {projectOpen ? (
          <div className="absolute left-0 right-0 top-full z-[130] mt-3 max-h-64 overflow-y-auto rounded-2xl border border-white/25 bg-white/95 p-2 shadow-2xl backdrop-blur-xl sm:left-0 sm:right-auto sm:w-80">
            <button
              type="button"
              onClick={() => {
                setCriteria((c) => ({ ...c, project: '', destination: '' }));
                setProjectOpen(false);
              }}
              className="flex w-full items-center justify-between border-b border-soul-line px-4 py-3 text-left text-sm text-soul-blue last:border-b-0 hover:bg-soul-blue-50/70"
            >
              <span>Any project</span>
              <span className="text-soul-muted/50">→</span>
            </button>
            {projects.map((option) => (
              <button
                key={option.id || option.name}
                type="button"
                onClick={() => {
                  setCriteria((c) => ({
                    ...c,
                    project: option.name,
                    destination: option.destination || option.area || '',
                  }));
                  setProjectOpen(false);
                }}
                className="flex w-full items-center justify-between border-b border-soul-line px-4 py-3 text-left text-sm text-soul-blue last:border-b-0 hover:bg-soul-blue-50/70"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{option.name}</span>
                  {option.destination ? (
                    <span className="block truncate text-[11px] text-soul-muted">{option.destination}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-soul-muted/50">→</span>
              </button>
            ))}
            {projects.length === 0 ? (
              <p className="px-4 py-3 text-sm text-soul-muted">No projects available yet.</p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Arrive / Depart — single range control */}
      <DateRangePicker
        variant="hero"
        checkin={criteria.checkin}
        checkout={criteria.checkout}
        onChange={({ checkin, checkout }) =>
          setCriteria((c) => ({ ...c, checkin: checkin || '', checkout: checkout || '' }))
        }
        onOpenChange={(open) => {
          if (open) {
            setProjectOpen(false);
            setGuestOpen(false);
          }
        }}
      />

      {/* Guests */}
      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setGuestOpen((o) => !o);
            setProjectOpen(false);
          }}
          className="flex w-full cursor-pointer flex-col gap-2 rounded-2xl border border-white/25 bg-white/10 px-5 py-4 text-left transition-colors hover:bg-white/20"
        >
          <span className="text-[11px] font-bold uppercase tracking-wider text-white/70">Guests</span>
          <span className="truncate text-sm font-medium text-white">
            {criteria.guests} Guest{criteria.guests === 1 ? '' : 's'}
          </span>
        </button>

        {guestOpen ? (
          <div className="absolute left-0 right-0 top-full z-[130] mt-3 rounded-2xl border border-white/25 bg-white/95 p-4 shadow-2xl backdrop-blur-xl sm:left-0 sm:right-auto sm:w-[340px]">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  setCriteria((c) => ({ ...c, guests: Math.max(1, c.guests - 1) }))
                }
                className="flex h-10 w-10 items-center justify-center rounded-full border border-soul-line text-xl font-semibold text-soul-blue transition-all hover:-translate-y-0.5 hover:bg-soul-blue hover:text-white active:scale-[0.98]"
              >
                −
              </button>
              <span className="text-sm font-semibold uppercase tracking-[0.18em] text-soul-blue">
                {criteria.guests} guests
              </span>
              <button
                type="button"
                onClick={() => setCriteria((c) => ({ ...c, guests: c.guests + 1 }))}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-soul-line text-xl font-semibold text-soul-blue transition-all hover:-translate-y-0.5 hover:bg-soul-blue hover:text-white active:scale-[0.98]"
              >
                +
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={criteria.checkin && criteria.checkout ? !hasValidRange : false}
        className="w-full rounded-xl border border-white/30 bg-white/90 py-3.5 text-[11px] font-bold uppercase tracking-[0.2em] text-soul-blue transition-all duration-300 hover:-translate-y-0.5 hover:bg-white hover:shadow-lg hover:shadow-soul-ink/20 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 sm:py-4 sm:text-xs"
      >
        Search Stays
      </button>
    </form>
  );
}
