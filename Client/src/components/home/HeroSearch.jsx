import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Minus, Plus, Search } from 'lucide-react';
import { useProjectCatalog } from '../../hooks/useProjectCatalog';
import DateRangePicker from '../ui/DateRangePicker';
import { useLocale } from '../../context/LocaleContext';

const isAfterDay = (a, b) => {
  const sa = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const sb = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return sa > sb;
};

const POPOVER =
  'absolute inset-x-0 top-full z-[130] mt-3 rounded-[22px] border border-soul-line bg-white p-2 shadow-[0_30px_80px_-30px_rgba(2,6,23,0.45)] lg:bottom-full lg:top-auto lg:mb-4 lg:mt-0';

export default function HeroSearch() {
  const navigate = useNavigate();
  const { t } = useLocale();
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

  const segment =
    'flex h-full w-full cursor-pointer flex-col justify-center rounded-2xl px-5 py-3 text-start transition-colors lg:rounded-full';

  return (
    <form
      ref={capsuleRef}
      onSubmit={handleSubmit}
      className="relative z-[60] grid w-full gap-1 rounded-[28px] border border-white/40 bg-white/95 p-2 text-soul-blue shadow-[0_40px_100px_-40px_rgba(2,6,23,0.75)] backdrop-blur-xl lg:grid-cols-[1.15fr_1.7fr_0.95fr_auto] lg:items-stretch lg:rounded-full"
    >
      <div className="relative lg:after:absolute lg:after:end-0 lg:after:top-1/2 lg:after:h-8 lg:after:w-px lg:after:-translate-y-1/2 lg:after:bg-soul-line">
        <button
          type="button"
          onClick={() => {
            setProjectOpen((o) => !o);
            setGuestOpen(false);
          }}
          className={`${segment} ${projectOpen ? 'bg-soul-blue-50' : 'hover:bg-soul-blue-50/60'}`}
        >
          <span className="g-index text-soul-muted">{t('home.project')}</span>
          <span className={`mt-1 truncate text-[15px] font-medium ${criteria.project ? 'text-soul-blue' : 'text-soul-muted/70'}`}>
            {criteria.project || t('home.whichProject')}
          </span>
        </button>

        {projectOpen ? (
          <div className={`${POPOVER} max-h-72 overflow-y-auto lg:w-[340px] lg:end-auto`}>
            <button
              type="button"
              onClick={() => {
                setCriteria((c) => ({ ...c, project: '', destination: '' }));
                setProjectOpen(false);
              }}
              className="group flex w-full items-center justify-between rounded-2xl px-4 py-3 text-start text-sm text-soul-blue hover:bg-soul-blue-50/70"
            >
              <span className="font-medium">{t('home.anyProject')}</span>
              <ArrowUpRight size={15} className="text-soul-muted/50 transition group-hover:text-soul-blue rtl:-scale-x-100" />
            </button>
            {projects.map((option, i) => (
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
                className="group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-start text-sm text-soul-blue hover:bg-soul-blue-50/70"
              >
                <span className="g-index w-6 shrink-0 text-soul-muted/60">{String(i + 1).padStart(2, '0')}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{option.name}</span>
                  {option.destination ? (
                    <span className="block truncate text-[11px] text-soul-muted">{option.destination}</span>
                  ) : null}
                </span>
                <ArrowUpRight size={15} className="shrink-0 text-soul-muted/40 transition group-hover:text-soul-blue rtl:-scale-x-100" />
              </button>
            ))}
            {projects.length === 0 ? (
              <p className="px-4 py-3 text-sm text-soul-muted">{t('home.noProjects')}</p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="relative lg:after:absolute lg:after:end-0 lg:after:top-1/2 lg:after:h-8 lg:after:w-px lg:after:-translate-y-1/2 lg:after:bg-soul-line">
        <DateRangePicker
          variant="bar"
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
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => {
            setGuestOpen((o) => !o);
            setProjectOpen(false);
          }}
          className={`${segment} ${guestOpen ? 'bg-soul-blue-50' : 'hover:bg-soul-blue-50/60'}`}
        >
          <span className="g-index text-soul-muted">{t('home.searchGuests')}</span>
          <span className="mt-1 truncate text-[15px] font-medium text-soul-blue">
            {t('common.guestsCount', { count: criteria.guests })}
          </span>
        </button>

        {guestOpen ? (
          <div className={`${POPOVER} p-4 lg:w-[300px] lg:start-auto`}>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setCriteria((c) => ({ ...c, guests: Math.max(1, c.guests - 1) }))}
                disabled={criteria.guests <= 1}
                className="grid h-11 w-11 place-items-center rounded-full border border-soul-line text-soul-blue transition-colors hover:border-soul-blue hover:bg-soul-blue hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-soul-blue"
                aria-label="-"
              >
                <Minus size={16} />
              </button>
              <span className="text-center">
                <span className="g-display block text-4xl">{criteria.guests}</span>
                <span className="g-index text-soul-muted">{t('home.searchGuests')}</span>
              </span>
              <button
                type="button"
                onClick={() => setCriteria((c) => ({ ...c, guests: c.guests + 1 }))}
                className="grid h-11 w-11 place-items-center rounded-full border border-soul-line text-soul-blue transition-colors hover:border-soul-blue hover:bg-soul-blue hover:text-white"
                aria-label="+"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={criteria.checkin && criteria.checkout ? !hasValidRange : false}
        className="group mt-1 inline-flex h-14 items-center justify-center gap-3 rounded-2xl bg-soul-blue px-7 text-[13px] font-semibold tracking-[0.04em] text-white transition-all duration-500 ease-soul hover:bg-soul-blue-dark disabled:cursor-not-allowed disabled:opacity-60 lg:mt-0 lg:h-full lg:rounded-full"
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-soul-blue transition-transform duration-500 ease-soul group-hover:rotate-90">
          <Search size={15} strokeWidth={2.4} />
        </span>
        <span>{t('home.searchStays')}</span>
      </button>
    </form>
  );
}
