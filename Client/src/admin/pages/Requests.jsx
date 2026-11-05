import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Plus } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import {
  canRequestLoan,
  canRequestStaffBenefits,
  canSeeRequestHistory,
  canSeeRequestQueue,
} from '../utils/permissions';
import { formatUnpaidLeaveAvailable } from '../utils/hrPolicy';
import { ROLE_LABELS } from '../utils/permissions';
import { useRequestCounts, REQUEST_CATEGORIES } from '../hooks/useRequestCounts';
import RequestsHistory from './RequestsHistory';
import NewRequestWizard from './requests/NewRequestWizard';
import { ScheduleCalendar, useMySchedule } from './requests/MySchedule';
import {
  ApprovalSteps,
  CategoryIcon,
  RejectModal,
  RequestDetailModal,
  ReviewButtons,
  StatusPill,
  cairoToday,
  requestDate,
  requestTitle,
  requestWhen,
  useRequestLists,
  useReviewRequest,
} from './requests/shared';

const LEGACY_TYPE = { holiday: 'holiday', wfh: 'wfh', loans: 'loan', loan: 'loan', excuse: 'excuse', mission: 'mission' };

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
            value === o.value ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-soul-blue'
          }`}
        >
          {o.label}
          {o.count ? (
            <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: 'var(--pms-accent, #F28C28)' }}>
              {o.count}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function Balance({ label, value, hint, tone }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${tone === 'warn' ? 'border-amber-200 bg-amber-50' : 'border-soul-line bg-white'}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-soul-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-soul-blue">{value}</p>
      {hint ? <p className="text-[11px] text-soul-muted">{hint}</p> : null}
    </div>
  );
}

function RequestRow({ item, onOpen, showPerson, review, onReject }) {
  const { row } = item;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => (e.key === 'Enter' ? onOpen(item) : null)}
      className="flex cursor-pointer flex-col gap-3 rounded-xl border border-soul-line bg-white p-3 transition hover:border-soul-blue/30 hover:shadow-sm sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <CategoryIcon category={item.category} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-soul-blue">{showPerson ? row.full_name : requestTitle(item)}</p>
            {showPerson ? <span className="text-xs text-soul-muted">{requestTitle(item)}</span> : null}
            <StatusPill row={row} />
          </div>
          <p className="text-sm text-soul-muted">{requestWhen(item)}</p>
          {row.reason ? <p className="mt-0.5 line-clamp-1 text-xs italic text-soul-muted">“{row.reason}”</p> : null}
          {row.review_note ? <p className="mt-0.5 line-clamp-1 text-xs text-soul-muted">Note: {row.review_note}</p> : null}
          <div className="mt-1.5">
            <ApprovalSteps item={item} />
          </div>
        </div>
      </div>
      {review ? <ReviewButtons item={item} review={review} onReject={onReject} /> : null}
    </div>
  );
}

function MyRequests({ user, leaveSnap, onNew, onOpen, mine, scheduleMonth, setScheduleMonth }) {
  const [status, setStatus] = useState('active');
  const today = cairoToday();
  const schedule = useMySchedule(user, scheduleMonth);
  const benefits = canRequestStaffBenefits(user);

  const list = useMemo(() => {
    const items = mine.items.filter((it) => {
      if (status === 'active') return it.row.status === 'pending' || (it.row.status === 'approved' && requestDate(it) >= today);
      if (status === 'all') return true;
      return it.row.status === status;
    });
    return items.sort((a, b) =>
      status === 'active' ? requestDate(a).localeCompare(requestDate(b)) : String(b.row.created_at).localeCompare(String(a.row.created_at))
    );
  }, [mine.items, status, today]);

  const pendingCount = mine.items.filter((it) => it.row.status === 'pending').length;

  const openScheduleItem = (s) => {
    const found = mine.items.find((it) => it.kind === s.kind && String(it.id) === String(s.id));
    if (found) onOpen(found);
  };

  return (
    <div className="space-y-5">
      {benefits && leaveSnap ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Balance label="Casual left" value={leaveSnap.can_request_holidays === false ? '—' : leaveSnap.casual_available} hint={leaveSnap.can_request_holidays === false ? 'Opens after 6 months' : 'days'} />
          <Balance label="Annual left" value={leaveSnap.can_request_holidays === false ? '—' : leaveSnap.annual_available} hint={leaveSnap.can_request_holidays === false ? 'Opens after 6 months' : 'days'} />
          <Balance
            label="Excuses this month"
            value={`${leaveSnap.paid_excuse_remaining ?? 0} / ${leaveSnap.paid_excuse_max ?? 2}`}
            hint="left · resets on the 26th"
            tone={(leaveSnap.paid_excuse_remaining ?? 0) < 1 ? 'warn' : null}
          />
          <Balance label="Unpaid" value={formatUnpaidLeaveAvailable(leaveSnap)} hint={pendingCount ? `${pendingCount} request${pendingCount === 1 ? '' : 's'} waiting` : 'days'} />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {benefits ? (
          <section className="card space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-soul-blue">My schedule</h2>
              <span className="text-[11px] text-soul-muted">Tap a day to request it</span>
            </div>
            <ScheduleCalendar
              data={schedule.data}
              month={scheduleMonth}
              onMonth={setScheduleMonth}
              today={schedule.data?.today || today}
              onDay={(day) => onNew({ date: day.date })}
              onItem={openScheduleItem}
            />
          </section>
        ) : null}

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-soul-blue">My requests</h2>
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Pending & upcoming' },
                { value: 'approved', label: 'Approved' },
                { value: 'rejected', label: 'Rejected' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
          {mine.isLoading ? (
            <LoadingSpinner />
          ) : list.length ? (
            <div className="space-y-2">
              {list.map((item) => (
                <RequestRow key={item.key} item={item} onOpen={onOpen} />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-soul-line p-6 text-center">
              <p className="text-sm text-soul-muted">Nothing here.</p>
              <button type="button" className="btn-primary mt-3 inline-flex items-center gap-2" onClick={() => onNew({})}>
                <Plus className="h-4 w-4" /> New request
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ReviewQueue({ incoming, counts, typeFilter, setTypeFilter, onOpen, review, onReject, userId }) {
  const [mode, setMode] = useState('waiting');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();

  const list = useMemo(() => {
    return incoming.items
      .filter((it) => String(it.row.staff_user_id) !== String(userId))
      .filter((it) => (mode === 'waiting' ? it.row.status === 'pending' && (it.row.can_review_slots || []).length : true))
      .filter((it) => typeFilter === 'all' || it.category === typeFilter)
      .filter((it) => !q || [it.row.full_name, it.row.staff_code, it.row.reason, requestTitle(it), ROLE_LABELS[it.row.role]].filter(Boolean).join(' ').toLowerCase().includes(q))
      .sort((a, b) =>
        mode === 'waiting' ? requestDate(a).localeCompare(requestDate(b)) : String(b.row.created_at).localeCompare(String(a.row.created_at))
      );
  }, [incoming.items, mode, typeFilter, q, userId]);

  const waitingCount = counts.review.total || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: 'waiting', label: 'Waiting for you', count: waitingCount },
            { value: 'all', label: 'All team requests' },
          ]}
        />
        <SearchFilter value={search} onChange={setSearch} placeholder="Search people or notes…" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[{ id: 'all', label: 'All types' }, ...REQUEST_CATEGORIES].map((c) => {
          const n = c.id === 'all' ? waitingCount : counts.review[c.id] || 0;
          const on = typeFilter === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setTypeFilter(c.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                on ? 'border-soul-blue bg-soul-blue text-white' : 'border-soul-line bg-white text-soul-muted hover:text-soul-blue'
              }`}
            >
              {c.label}
              {n ? (
                <span className={`rounded-full px-1.5 text-[10px] font-bold ${on ? 'bg-white text-soul-blue' : 'text-white'}`} style={on ? undefined : { background: 'var(--pms-accent, #F28C28)' }}>
                  {n}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {incoming.isLoading ? (
        <LoadingSpinner />
      ) : list.length ? (
        <div className="space-y-2">
          {list.map((item) => (
            <RequestRow key={item.key} item={item} onOpen={onOpen} showPerson review={review} onReject={onReject} />
          ))}
        </div>
      ) : (
        <EmptyState icon={Inbox} title={mode === 'waiting' ? 'Nothing is waiting for you' : 'No requests match'} />
      )}
    </div>
  );
}

export default function Requests() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const canQueue = canSeeRequestQueue(user);
  const canHistory = canSeeRequestHistory(user);
  const canAsk = canRequestStaffBenefits(user) || canRequestLoan(user);
  const counts = useRequestCounts(user);
  const [wizard, setWizard] = useState(null);
  const [detail, setDetail] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [scheduleMonth, setScheduleMonth] = useState(cairoToday().slice(0, 7));

  const tabs = [
    canAsk ? { id: 'mine', label: 'My requests', count: counts.unseen_decisions } : null,
    canQueue ? { id: 'review', label: 'To review', count: counts.review.total } : null,
    canHistory ? { id: 'history', label: 'History' } : null,
  ].filter(Boolean);

  // Old links used ?view=incoming and ?type=holiday|wfh|loans.
  const rawTab = params.get('tab') || (params.get('view') === 'incoming' ? 'review' : null);
  const fallbackTab = !canRequestStaffBenefits(user) && canQueue ? 'review' : tabs[0]?.id;
  const active = tabs.find((t) => t.id === rawTab)?.id || fallbackTab;
  const typeFilter = LEGACY_TYPE[params.get('type')] || 'all';
  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v == null ? next.delete(k) : next.set(k, v)));
    next.delete('view');
    setParams(next, { replace: true });
  };

  const { data: leaveSnap } = useQuery({
    queryKey: ['hr-my-leave', user?.id],
    queryFn: () => api.get('/hr/my-leave').then((r) => r.data),
    enabled: Boolean(user?.id && canRequestStaffBenefits(user)),
  });
  const mine = useRequestLists({ user, mine: true, enabled: canAsk });
  const incoming = useRequestLists({ user, mine: false, enabled: canQueue });

  const review = useReviewRequest({
    onDone: () => {
      setRejecting(null);
      setDetail(null);
    },
  });

  // Opening "My requests" marks "your request was approved/rejected" notifications as seen.
  useEffect(() => {
    if (active !== 'mine' || !counts.unseen_decisions) return;
    api.post('/hr/requests/seen').then(() => {
      qc.invalidateQueries({ queryKey: ['hr-requests-counts'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }).catch(() => {});
  }, [active, counts.unseen_decisions, qc]);

  // Deep link from a notification: ?open=leave:123
  const openKey = params.get('open');
  useEffect(() => {
    if (!openKey) return;
    const found = [...mine.items, ...incoming.items].find((it) => it.key === openKey);
    if (found) {
      setDetail(found);
      setParam({ open: null });
    } else if (!mine.isLoading && !incoming.isLoading) {
      setParam({ open: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, mine.items.length, incoming.items.length, mine.isLoading, incoming.isLoading]);

  // Keep the open request fresh while it's on screen (e.g. someone else approves it).
  const liveDetail = detail ? [...mine.items, ...incoming.items].find((it) => it.key === detail.key) || detail : null;

  return (
    <div className="space-y-5">
      <div className="page-header mb-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
          <h1 className="page-title mt-1">Requests</h1>
          <p className="page-subtitle">
            Holidays, excuses, missions and work from home go to your manager, then the HR Manager. Loans go to the HR Manager, then the
            Financial Manager. You get a notification at every step.
          </p>
        </div>
        {canAsk ? (
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => setWizard({})}>
            <Plus className="h-4 w-4" /> New request
          </button>
        ) : null}
      </div>

      {tabs.length > 1 ? (
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 sm:w-fit">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setParam({ tab: t.id, type: null })}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition sm:flex-none ${
                active === t.id ? 'bg-white text-soul-blue shadow-sm' : 'text-slate-500 hover:text-soul-blue'
              }`}
            >
              {t.label}
              {t.count ? (
                <span className="rounded-full px-1.5 text-[10px] font-bold text-white" style={{ background: 'var(--pms-accent, #F28C28)' }}>
                  {t.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {active === 'mine' ? (
        <MyRequests
          user={user}
          leaveSnap={leaveSnap}
          mine={mine}
          onNew={(init) => setWizard(init)}
          onOpen={setDetail}
          scheduleMonth={scheduleMonth}
          setScheduleMonth={setScheduleMonth}
        />
      ) : null}
      {active === 'review' ? (
        <ReviewQueue
          incoming={incoming}
          counts={counts}
          typeFilter={typeFilter}
          setTypeFilter={(id) => setParam({ type: id === 'all' ? null : id })}
          onOpen={setDetail}
          review={review}
          onReject={setRejecting}
          userId={user?.id}
        />
      ) : null}
      {active === 'history' ? <RequestsHistory /> : null}

      {wizard ? <NewRequestWizard user={user} leaveSnap={leaveSnap} initial={wizard} onClose={() => setWizard(null)} /> : null}
      <RequestDetailModal
        item={liveDetail}
        review={review}
        showPerson={String(liveDetail?.row.staff_user_id) !== String(user?.id)}
        onReject={(item) => {
          setDetail(null);
          setRejecting(item);
        }}
        onClose={() => setDetail(null)}
      />
      {rejecting ? <RejectModal item={rejecting} review={review} onClose={() => setRejecting(null)} /> : null}
    </div>
  );
}
