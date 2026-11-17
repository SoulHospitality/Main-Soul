import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BedDouble,
  CheckCircle2,
  Circle,
  KeyRound,
  LogOut,
  RefreshCw,
  SprayCan,
  UserX,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { canAccess } from '../utils/permissions';
import { currency } from '../utils/formatters';
import { formatOpsDay } from '../components/OpsDateRangeFilter';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { summarizeOpsDay, useHkCleans, useOpsCheckins, useOpsCheckouts, useUnitBoard } from '../hooks/useOpsDay';

const DAY_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'tomorrow', label: 'Tomorrow' },
];

function Progress({ done, total, tone }) {
  const pct = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className="mt-3 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden" aria-hidden="true">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Tile({ icon: Icon, label, done, total, hint, tone, onClick }) {
  const allDone = total > 0 && done >= total;
  return (
    <button
      type="button"
      onClick={onClick}
      className="card p-4 text-left hover:shadow-md hover:border-soul-blue/30 transition group"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <Icon className="w-4 h-4 text-gray-400 group-hover:text-soul-blue" />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold text-gray-900 tabular-nums">{total - done}</span>
        <span className="text-sm text-gray-500">to do</span>
      </div>
      <div className="text-xs text-gray-500 mt-0.5">
        {total ? (allDone ? 'All done' : `${done} of ${total} done`) : hint}
      </div>
      <Progress done={done} total={total} tone={allDone ? 'bg-emerald-500' : tone} />
    </button>
  );
}

function Step({ ok, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {ok ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
      {label}
    </span>
  );
}

const SEVERITY_TONE = {
  high: 'border-l-red-500 bg-red-50/60',
  medium: 'border-l-amber-500 bg-amber-50/60',
  low: 'border-l-sky-500 bg-sky-50/60',
};

export function TodayBoardSection({ onOpen }) {
  const { user } = useAuth();
  const [day, setDay] = useState('today');
  const canAssign = user?.role === 'admin' || user?.role === 'operations_supervisor';
  const seesGuests = canAccess(user, 'ops_checkins');
  const seesCleans = canAccess(user, 'hk_today');

  const checkinsQ = useOpsCheckins(day, seesGuests);
  const checkoutsQ = useOpsCheckouts(day, seesGuests);
  const cleansQ = useHkCleans(day, seesCleans);
  const boardQ = useUnitBoard(day, seesGuests);

  const checkins = checkinsQ.data?.items || [];
  const checkouts = checkoutsQ.data?.items || [];
  const cleans = cleansQ.data?.items || [];
  const board = boardQ.data?.items || [];
  const sum = summarizeOpsDay({ checkins, checkouts, cleans });
  const boardCounts = boardQ.data?.counts || {};
  const toTurn = (boardCounts.turnover || 0) + (boardCounts.arriving_not_ready || 0) + (boardCounts.needs_cleaning || 0);

  const loading = [checkinsQ, checkoutsQ, cleansQ].some((q) => q.isLoading && q.fetchStatus !== 'idle');
  const open = (tab) => onOpen?.(tab, day);
  const refreshAll = () => [checkinsQ, checkoutsQ, cleansQ, boardQ].forEach((q) => q.refetch?.());

  // Everything that will stop a guest getting their keys on time, most urgent first.
  const alerts = useMemo(() => {
    const out = [];
    for (const r of board) {
      if (r.state === 'turnover') {
        out.push({
          key: `turn-${r.unit_id}`, severity: 'high', icon: RefreshCw, tab: 'checkouts',
          title: `Same-day turnover · ${r.unit_number || r.unit_title}`,
          detail: 'Guest leaves and the next one arrives today. Check out early and send a cleaner straight after.',
        });
      }
    }
    for (const r of checkins) {
      if (r.ops_handed_over) continue;
      const unit = r.unit_number || r.unit_title || 'Unit';
      if (!r.hk_cleaned) {
        out.push({
          key: `clean-${r.id}`, severity: 'high', icon: SprayCan, tab: 'cleans',
          title: `${unit} not cleaned yet`, detail: `${r.guest_name || 'Guest'} arrives ${formatOpsDay(r.check_in)}.`,
        });
      }
      if (!r.ops_money_collected && Number(r.remaining_amount) > 0.5) {
        out.push({
          key: `pay-${r.id}`, severity: 'medium', icon: Wallet, tab: 'today',
          title: `Collect ${currency(r.remaining_amount)} · ${unit}`, detail: `${r.guest_name || 'Guest'} still owes the balance.`,
        });
      }
      if (canAssign && !r.ops_assigned_to) {
        out.push({
          key: `agent-in-${r.id}`, severity: 'medium', icon: UserX, tab: 'today',
          title: `No agent for check-in · ${unit}`, detail: `${r.guest_name || 'Guest'} · ${formatOpsDay(r.check_in)}`,
        });
      }
    }
    for (const r of cleans) {
      if (r.cleaned || r.assigned_to || !canAssign) continue;
      out.push({
        key: `cleaner-${r.task_id}`, severity: 'medium', icon: UserX, tab: 'cleans',
        title: `No cleaner · ${r.unit_number || r.unit_title}`, detail: `Clean on ${formatOpsDay(r.clean_date)}.`,
      });
    }
    for (const r of checkouts) {
      const unit = r.unit_number || r.unit_title || 'Unit';
      if (r.can_refund_insurance) {
        out.push({
          key: `ins-${r.id}`, severity: 'low', icon: Wallet, tab: 'checkouts',
          title: `Settle insurance ${currency(r.insurance)} · ${unit}`, detail: `${r.guest_name || 'Guest'} checks out ${formatOpsDay(r.check_out)}.`,
        });
      }
      if (canAssign && !r.checkout_handler_id) {
        out.push({
          key: `agent-out-${r.id}`, severity: 'low', icon: UserX, tab: 'checkouts',
          title: `No agent for checkout · ${unit}`, detail: r.guest_name || 'Guest',
        });
      }
    }
    const rank = { high: 0, medium: 1, low: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }, [board, checkins, checkouts, cleans, canAssign]);

  // One line per unit with everything happening there today: out, clean, in.
  const plan = useMemo(() => {
    const byUnit = new Map();
    const row = (unitId, unit, project) => {
      const k = String(unitId || unit);
      if (!byUnit.has(k)) byUnit.set(k, { key: k, unit, project, out: null, clean: null, in: null });
      return byUnit.get(k);
    };
    for (const r of checkouts) row(r.unit_id, r.unit_number || r.unit_title, r.project).out = r;
    for (const r of cleans) row(r.unit_id, r.unit_number || r.unit_title, r.project).clean = r;
    for (const r of checkins) row(r.unit_id, r.unit_number || r.unit_title, r.project).in = r;
    const urgency = (p) => {
      if (p.in && !p.in.ops_handed_over && !p.in.hk_cleaned) return 0;
      if (p.in && p.out) return 1;
      if (p.in && !p.in.ops_handed_over) return 2;
      if (p.clean && !p.clean.cleaned) return 3;
      if (p.out && p.out.status !== 'checked_out') return 4;
      return 5;
    };
    return [...byUnit.values()].sort((a, b) => urgency(a) - urgency(b) || String(a.unit).localeCompare(String(b.unit)));
  }, [checkins, checkouts, cleans]);

  const dayLabel = day === 'today' ? 'today' : 'tomorrow';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
          {DAY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDay(opt.value)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                day === opt.value ? 'bg-white text-soul-blue shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={refreshAll}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {seesGuests ? (
          <Tile icon={KeyRound} label="Check-ins" done={sum.arrivals.done} total={sum.arrivals.total}
            hint={`No arrivals ${dayLabel}`} tone="bg-soul-blue" onClick={() => open('today')} />
        ) : null}
        {seesGuests ? (
          <Tile icon={LogOut} label="Checkouts" done={sum.departures.done} total={sum.departures.total}
            hint={`No departures ${dayLabel}`} tone="bg-orange-500" onClick={() => open('checkouts')} />
        ) : null}
        {seesCleans ? (
          <Tile icon={SprayCan} label="Cleans" done={sum.cleans.done} total={sum.cleans.total}
            hint={`No cleans ${dayLabel}`} tone="bg-sky-500" onClick={() => open('cleans')} />
        ) : null}
        {seesGuests ? (
          <button type="button" onClick={() => open('units')}
            className="card p-4 text-left hover:shadow-md hover:border-soul-blue/30 transition group">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Units</span>
              <BedDouble className="w-4 h-4 text-gray-400 group-hover:text-soul-blue" />
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-bold text-gray-900 tabular-nums">{toTurn}</span>
              <span className="text-sm text-gray-500">to turn</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {boardCounts.occupied || 0} occupied · {(boardCounts.vacant || 0) + (boardCounts.arriving_ready || 0)} ready
            </div>
            <div className="mt-3 text-xs font-medium text-soul-blue inline-flex items-center gap-1">
              Unit status board <ArrowRight className="w-3 h-3" />
            </div>
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className="card p-10 flex justify-center"><LoadingSpinner /></div>
      ) : (
        <div className="grid lg:grid-cols-5 gap-4 items-start">
          <section className="lg:col-span-2 card p-0 overflow-hidden">
            <header className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="font-semibold text-gray-900 inline-flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Needs attention
              </h2>
              <span className="text-xs font-semibold rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">{alerts.length}</span>
            </header>
            {alerts.length ? (
              <ul className="divide-y max-h-[32rem] overflow-y-auto">
                {alerts.map((a) => {
                  const Icon = a.icon;
                  return (
                    <li key={a.key}>
                      <button type="button" onClick={() => open(a.tab)}
                        className={`w-full text-left px-4 py-3 border-l-4 ${SEVERITY_TONE[a.severity]} hover:bg-white flex gap-3 items-start`}>
                        <Icon className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-gray-900">{a.title}</span>
                          <span className="block text-xs text-gray-600">{a.detail}</span>
                        </span>
                        <ArrowRight className="w-4 h-4 mt-0.5 text-gray-400 shrink-0" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="mt-2 text-sm font-medium text-gray-700">Nothing blocking {dayLabel}.</p>
                <p className="text-xs text-gray-500">Every unit is on track.</p>
              </div>
            )}
          </section>

          <section className="lg:col-span-3 card p-0 overflow-hidden">
            <header className="px-4 py-3 border-b">
              <h2 className="font-semibold text-gray-900">Day plan by unit</h2>
              <p className="text-xs text-gray-500">Checkout → clean → check-in for each unit, most urgent first.</p>
            </header>
            {plan.length ? (
              <ul className="divide-y">
                {plan.map((p) => (
                  <li key={p.key} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-semibold text-gray-900">{p.unit || 'Unit'}</span>
                        {p.project ? <span className="ml-2 text-xs text-gray-500">{p.project}</span> : null}
                      </div>
                      {p.in && p.out ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-rose-700 bg-rose-50 rounded px-1.5 py-0.5">Turnover</span>
                      ) : null}
                    </div>
                    <div className="mt-2 grid sm:grid-cols-3 gap-2 text-xs">
                      <button type="button" disabled={!p.out} onClick={() => open('checkouts')}
                        className={`rounded-lg border px-2.5 py-2 text-left ${p.out ? 'hover:border-orange-300' : 'opacity-40 cursor-default'}`}>
                        <div className="font-semibold text-gray-700 inline-flex items-center gap-1"><LogOut className="w-3 h-3" /> Out</div>
                        {p.out ? (
                          <>
                            <div className="text-gray-600 truncate">{p.out.guest_name || 'Guest'}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Step ok={p.out.status === 'checked_out'} label="Left" />
                              {Number(p.out.insurance) > 0.009 ? <Step ok={!p.out.can_refund_insurance} label="Insurance" /> : null}
                            </div>
                          </>
                        ) : <div className="text-gray-400">—</div>}
                      </button>
                      <button type="button" disabled={!p.clean} onClick={() => open('cleans')}
                        className={`rounded-lg border px-2.5 py-2 text-left ${p.clean ? 'hover:border-sky-300' : 'opacity-40 cursor-default'}`}>
                        <div className="font-semibold text-gray-700 inline-flex items-center gap-1"><SprayCan className="w-3 h-3" /> Clean</div>
                        {p.clean ? (
                          <>
                            <div className="text-gray-600 truncate">{p.clean.assignee_name || 'Unassigned'}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Step ok={p.clean.in_progress || p.clean.cleaned} label="Started" />
                              <Step ok={p.clean.cleaned} label="Ready" />
                            </div>
                          </>
                        ) : <div className="text-gray-400">—</div>}
                      </button>
                      <button type="button" disabled={!p.in} onClick={() => open('today')}
                        className={`rounded-lg border px-2.5 py-2 text-left ${p.in ? 'hover:border-soul-blue/40' : 'opacity-40 cursor-default'}`}>
                        <div className="font-semibold text-gray-700 inline-flex items-center gap-1"><KeyRound className="w-3 h-3" /> In</div>
                        {p.in ? (
                          <>
                            <div className="text-gray-600 truncate">{p.in.guest_name || 'Guest'}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                              <Step ok={p.in.hk_cleaned} label="Clean" />
                              <Step ok={p.in.ops_money_collected} label="Paid" />
                              <Step ok={p.in.ops_handed_over} label="Keys" />
                            </div>
                          </>
                        ) : <div className="text-gray-400">—</div>}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-gray-500">No check-ins, checkouts or cleans {dayLabel}.</div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default TodayBoardSection;
