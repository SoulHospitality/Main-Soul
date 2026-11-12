import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coins,
  Download,
  HeartPulse,
  Plus,
  Receipt,
  Shield,
  Users,
} from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { currency, formatDate } from '../../utils/formatters';
import { FINANCE_BOOKS_START as FINANCIAL_EPOCH } from '../../utils/financialEpoch';
import { useFinLocale } from '../../context/FinLocaleContext';
import { GROUP_META, rangeParams } from './shared';
import { SubAccountAddModal } from './accounts';
import DataTable from './DataTable';
import { TimelineLink, useWorkspace } from './workspace';
import { AgingTool, ArControlsTool } from './receivables';
import { OwnerStatementsTab, OwnerTrustTool } from './owners';
import { CashFlowTool, ReportsTool, SegmentPnlTool } from './reports';
import { FixedChargesSection, PaymentCalendarTool } from './calendar';
import { BankRecTool, GatewayTool } from './reconcile';
import { CloseTool } from './close';

/* ---------- Shared bits ---------- */

/** Tabs kept in the address (?sub=) so a merged page opens on the right tab from any link. */
export function Tabs({ tabs }) {
  const [params, setParams] = useSearchParams();
  const active = tabs.find((x) => x.id === params.get('sub')) || tabs[0];
  return (
    <div className="space-y-4">
      <div className="inline-flex flex-wrap gap-1 rounded-xl border border-soul-line bg-white p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              const next = new URLSearchParams(params);
              next.set('sub', tab.id);
              setParams(next, { replace: true });
            }}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${active.id === tab.id ? 'bg-soul-blue text-white' : 'text-gray-600 hover:bg-slate-50'}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div key={active.id}>{active.render()}</div>
    </div>
  );
}

function useToday() {
  return useQuery({
    queryKey: ['financial-system-today'],
    queryFn: () => api.get('/financial-system/today').then((r) => r.data),
    staleTime: 60_000,
  });
}
export function useHealth() {
  return useQuery({
    queryKey: ['financial-system-health'],
    queryFn: () => api.get('/financial-system/health').then((r) => r.data),
    staleTime: 120_000,
  });
}
/** Counts for the sidebar badges, by page. */
export function useNavBadges() {
  const today = useToday();
  const health = useHealth();
  const by = {};
  for (const item of today.data?.items || []) by[item.tool] = (by[item.tool] || 0) + (item.count || 0);
  by.health = health.data?.issues || 0;
  return by;
}

function shiftDay(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** The period just before the selected one, the same length (a whole month maps to the previous month). */
function previousRange(from, to) {
  if (!from || !to) return null;
  const isMonth = from.endsWith('-01') && shiftDay(to, 1).endsWith('-01') && from.slice(0, 7) === to.slice(0, 7);
  let prevFrom;
  let prevTo;
  if (isMonth) {
    prevTo = shiftDay(from, -1);
    prevFrom = `${prevTo.slice(0, 7)}-01`;
  } else {
    const days = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
    prevTo = shiftDay(from, -1);
    prevFrom = shiftDay(prevTo, -(days - 1));
  }
  if (prevTo < FINANCIAL_EPOCH) return null;
  return { from: prevFrom < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : prevFrom, to: prevTo };
}

function Change({ now, before }) {
  const { t } = useFinLocale();
  if (before == null || !Number.isFinite(Number(before))) return null;
  const diff = Number(now || 0) - Number(before || 0);
  if (Math.abs(diff) < 0.5) return <p className="mt-1 text-xs text-gray-400">{t('pms.fin.today.noChange')}</p>;
  const pct = Number(before) ? Math.round((diff / Math.abs(Number(before))) * 100) : null;
  return (
    <p className={`mt-1 text-xs font-medium ${diff > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
      {diff > 0 ? '▲' : '▼'} {currency(Math.abs(diff))}
      {pct != null ? ` (${pct > 0 ? '+' : ''}${pct}%)` : ''} {t('pms.fin.today.vsBefore')}
    </p>
  );
}

const ITEM_ICONS = {
  collection: Banknote,
  refunds: Receipt,
  calendar_overdue: CalendarDays,
  calendar_soon: CalendarDays,
  insurance: Shield,
  left_owing: AlertCircle,
  vendor_bills: Receipt,
  owner_payouts: Users,
};

/* ---------- Today ---------- */

export function TodayPage({ data, isLoading, period, onOpenGroup, onOpenAccount, onExport, exporting }) {
  const { t } = useFinLocale();
  const { openTool } = useWorkspace();
  const today = useToday();
  const health = useHealth();
  const prev = previousRange(period.from, period.to);
  const prevPortal = useQuery({
    queryKey: ['financial-system-portal', prev?.from, prev?.to, period.basis],
    queryFn: () => api.get('/financial-system/portal', { params: rangeParams(prev.from, prev.to, period.basis) }).then((r) => r.data),
    enabled: Boolean(prev),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <LoadingSpinner />;
  const kpis = data?.kpis || {};
  const before = prevPortal.data?.kpis || null;
  const outstanding = data?.outstanding || { amount: 0, count: 0 };
  const treasury = data?.treasury || [];
  const items = today.data?.items || [];
  const issues = health.data?.issues || 0;

  const tiles = [
    { label: t('pms.fin.home.collectedInTreasury'), amount: kpis.collected, before: before?.collected, onClick: () => onOpenGroup('assets'), sub: t('pms.fin.today.collectedSub') },
    { label: t('pms.fin.home.grossRevenue'), amount: kpis.gross_revenue ?? kpis.revenue, before: before ? before.gross_revenue ?? before.revenue : null, onClick: () => onOpenGroup('revenue'), sub: t('pms.fin.today.revenueSub') },
    { label: t('pms.fin.home.outstanding'), amount: outstanding.amount, onClick: () => openTool('outstanding'), sub: t('pms.fin.home.outstandingHint', { count: outstanding.count }) },
    { label: t('pms.fin.home.ownerTrust'), amount: kpis.owner_trust, before: before?.owner_trust, onClick: () => onOpenAccount('202000'), sub: t('pms.fin.home.ownerTrustHint') },
  ];

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {t('pms.fin.today.period', { from: formatDate(period.from), to: period.to ? formatDate(period.to) : '…' })}
          {prev ? ` · ${t('pms.fin.today.comparedWith', { from: formatDate(prev.from), to: formatDate(prev.to) })}` : ''}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={onExport} disabled={exporting}>
          <Download className="h-4 w-4" /> {exporting ? t('pms.fin.exporting') : t('pms.fin.exportExcel')}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map((tile) => (
          <button key={tile.label} type="button" onClick={tile.onClick} className="rounded-2xl border border-soul-line bg-white px-4 py-4 text-start hover:border-soul-blue/40 hover:bg-soul-blue-50/30">
            <p className="flex items-center justify-between text-[11px] uppercase tracking-wider text-gray-400">
              {tile.label} <ChevronRight className="h-4 w-4 text-gray-300 rtl:rotate-180" />
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-soul-blue">{currency(tile.amount)}</p>
            {tile.before !== undefined ? <Change now={tile.amount} before={tile.before} /> : null}
            <p className="mt-1 text-xs text-gray-500">{tile.sub}</p>
          </button>
        ))}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-soul-blue">{t('pms.fin.today.attention')}</h2>
            <p className="text-xs text-gray-500">{t('pms.fin.today.attentionHint')}</p>
          </div>
          <button
            type="button"
            onClick={() => openTool('health')}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ${issues ? 'bg-rose-50 text-rose-700 hover:bg-rose-100' : 'bg-emerald-50 text-emerald-700'}`}
          >
            <HeartPulse className="h-4 w-4" />
            {issues ? t('pms.fin.today.healthIssues', { count: issues }) : t('pms.fin.today.healthClear')}
          </button>
        </div>
        {today.isLoading ? (
          <LoadingSpinner />
        ) : items.length ? (
          <ul className="divide-y divide-soul-line overflow-hidden rounded-2xl border border-soul-line bg-white">
            {items.map((item) => {
              const Icon = ITEM_ICONS[item.id] || AlertCircle;
              const high = item.severity === 'high';
              return (
                <li key={item.id}>
                  <button type="button" onClick={() => openTool(item.tool)} className="flex w-full items-center gap-4 px-4 py-3.5 text-start hover:bg-slate-50">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${high ? 'bg-rose-50 text-rose-600' : 'bg-soul-blue-50 text-soul-blue'}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-semibold text-gray-900">
                        {t(`pms.fin.today.items.${item.id}.title`, { count: item.count })}
                        {high ? <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">{t('pms.fin.today.urgent')}</span> : null}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {t(`pms.fin.today.items.${item.id}.detail`, { count: item.count, old: item.old || 0, ...(item.detail || {}) })}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className="block font-bold tabular-nums text-soul-blue">{currency(item.amount)}</span>
                      <span className="block text-xs text-gray-400 tabular-nums">{item.count === 1 ? t('pms.fin.today.item_one') : t('pms.fin.today.items_count', { count: item.count })}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 rtl:rotate-180" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 text-sm text-emerald-800">
            <CheckCircle2 className="h-5 w-5" /> {t('pms.fin.today.allClear')}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-soul-blue">{t('pms.fin.home.treasury')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {treasury.map((acct) => {
            const Icon = acct.kind === 'cash' ? Banknote : Coins;
            return (
              <button key={acct.code} type="button" onClick={() => onOpenAccount(acct.code)} className="rounded-2xl border border-soul-line bg-white p-4 text-start hover:border-soul-blue/40">
                <div className="flex items-center gap-3">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl text-white ${acct.kind === 'cash' ? 'bg-emerald-600' : 'bg-soul-blue'}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-soul-blue">{acct.name.replace(/^Bank - |^Cash - /, '')}</span>
                    <span className="block font-mono text-[11px] text-gray-400">{acct.code} · {acct.currency}</span>
                  </span>
                </div>
                <p className="mt-3 text-xl font-bold tabular-nums">{acct.currency === 'USD' ? currency(acct.usd_balance || 0, 'USD') : currency(acct.balance)}</p>
                <p className="mt-1 text-xs text-gray-500">{t('pms.fin.home.inOut', { inflow: currency(acct.inflow), outflow: currency(acct.outflow) })}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ---------- Data health ---------- */

const RESERVATION_FIELD = {
  down_payment_dropped: 'id',
  pre_reset_payments: 'id',
  overpaid: 'id',
  write_offs_not_applied: 'reservation_id',
  placeholders: 'reservation_id',
  collection_waiting: 'reservation_id',
  closed_month_edits: 'reservation_id',
};

export function HealthPage() {
  const { t } = useFinLocale();
  const { openTool } = useWorkspace();
  const health = useHealth();
  const trust = useQuery({
    queryKey: ['financial-system-owner-trust-health'],
    queryFn: () => api.get('/financial-system/owner-trust').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const [open, setOpen] = useState(null);
  if (health.isLoading) return <LoadingSpinner />;
  // Problems first (most serious, then largest), passing checks after.
  const rank = { high: 0, medium: 1 };
  const checks = [...(health.data?.checks || [])].sort((a, b) => (b.count > 0) - (a.count > 0) || (rank[a.severity] ?? 2) - (rank[b.severity] ?? 2) || b.amount - a.amount);
  const ownersSum = (trust.data?.owners || []).reduce((s, o) => s + (Number(o.balance) || 0), 0);

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-gray-500">{t('pms.fin.health.intro')}</p>
      <div className="space-y-3">
        {trust.data ? (
          <div className={`flex flex-wrap items-center gap-3 rounded-2xl border px-5 py-4 ${trust.data.tied ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/50'}`}>
            {trust.data.tied ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-rose-600" />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900">{trust.data.tied ? t('pms.fin.health.trustTied') : t('pms.fin.health.trustNotTied')}</p>
              <p className="text-xs text-gray-500">{t('pms.fin.health.trustDetail', { control: currency(trust.data.control_202000), owners: currency(ownersSum) })}</p>
            </div>
            <button type="button" className="btn-secondary text-sm" onClick={() => openTool('owners', 'trust')}>{t('pms.fin.health.open')}</button>
          </div>
        ) : null}
        {checks.map((c) => {
          const ok = !c.count;
          const tone = ok ? 'border-soul-line bg-white' : c.severity === 'high' ? 'border-rose-200 bg-rose-50/40' : 'border-amber-200 bg-amber-50/40';
          const resField = RESERVATION_FIELD[c.id];
          return (
            <div key={c.id} className={`rounded-2xl border ${tone}`}>
              <button type="button" disabled={ok} onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full items-start gap-3 px-5 py-4 text-start">
                {ok ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${c.severity === 'high' ? 'text-rose-600' : 'text-amber-600'}`} />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900">{t(`pms.fin.health.checks.${c.id}.title`)}</span>
                  <span className="block text-xs text-gray-500">{ok ? t('pms.fin.health.ok') : t(`pms.fin.health.checks.${c.id}.what`)}</span>
                  {!ok ? <span className="mt-1 block text-xs text-soul-blue">{t(`pms.fin.health.checks.${c.id}.fix`)}</span> : null}
                </span>
                {!ok ? (
                  <span className="text-end">
                    <span className="block font-bold tabular-nums">{c.amount ? currency(c.amount) : ''}</span>
                    <span className="block text-xs text-gray-500">{c.count === 1 ? t('pms.fin.today.item_one') : t('pms.fin.today.items_count', { count: c.count })}</span>
                  </span>
                ) : null}
                {!ok ? <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-gray-400 transition ${open === c.id ? 'rotate-180' : ''}`} /> : null}
              </button>
              {open === c.id ? (
                <div className="space-y-3 border-t border-soul-line/70 px-4 pb-4 pt-3">
                  <DataTable
                    rows={c.rows}
                    rowKey={(r) => `${c.id}-${r.id}`}
                    exportName={`health-${c.id}`}
                    dense
                    columns={[
                      {
                        key: 'guest_name',
                        label: t('pms.fin.health.colName'),
                        render: (r) => (resField && r[resField] ? <TimelineLink id={r[resField]}>{r.guest_name || `#${r[resField]}`}</TimelineLink> : r.guest_name || r.ref || r.id),
                      },
                      { key: 'check_in', label: t('pms.fin.table.date'), nowrap: true, render: (r) => (r.check_in ? formatDate(r.check_in) : '—') },
                      { key: 'ref', label: t('pms.fin.table.details'), render: (r) => <span className="text-xs text-gray-500">{r.ref || (r.paid != null ? t('pms.fin.health.paidNow', { amount: currency(r.paid) }) : '')}</span> },
                      { key: 'amount', label: t('pms.fin.table.amount'), align: 'end', money: true, total: true },
                    ]}
                  />
                  {c.tool && c.tool !== 'search' ? (
                    <button type="button" className="btn-secondary text-sm" onClick={() => openTool(c.tool)}>
                      {t('pms.fin.health.goTo')}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Chart of accounts ---------- */

export function AccountsPage({ data, isLoading, onOpenGroup }) {
  const { t } = useFinLocale();
  const [addOpen, setAddOpen] = useState(false);
  if (isLoading) return <LoadingSpinner />;
  const groups = data?.groups || [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-2xl text-sm text-gray-500">{t('pms.fin.home.chartHint')}</p>
        <button type="button" className="btn-primary text-sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> {t('pms.fin.subAccount.add')}
        </button>
      </div>
      <SubAccountAddModal key={addOpen ? 'open' : 'closed'} open={addOpen} onClose={() => setAddOpen(false)} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groups.map((g) => {
          const meta = GROUP_META[g.id] || GROUP_META.assets;
          const Icon = meta.icon;
          return (
            <button key={g.id} type="button" onClick={() => onOpenGroup(g.id)} className="rounded-2xl border border-soul-line bg-white p-5 text-start hover:border-soul-blue/40">
              <div className="flex items-start gap-4">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${meta.tile}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center justify-between gap-2 font-semibold text-soul-blue">
                    {meta.label} <ChevronRight className="h-4 w-4 text-gray-300 rtl:rotate-180" />
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">{t(`pms.fin.groupMeta.${g.id}Hint`) || meta.hint}</p>
                  <p className="mt-3 text-xl font-bold tabular-nums">{currency(g.balance)}</p>
                  <p className="mt-1 text-xs text-gray-400">{t('pms.fin.subAccounts', { count: g.accounts ? g.accounts.length : g.account_count })}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Merged pages ---------- */

export function OutstandingPage({ params, onOpenAccount }) {
  const { t } = useFinLocale();
  return (
    <Tabs
      tabs={[
        { id: 'owes', label: t('pms.fin.nav.tabs.whoOwes'), render: () => <AgingTool rangeParams={params} onOpenAccount={onOpenAccount} /> },
        { id: 'followup', label: t('pms.fin.nav.tabs.followUp'), render: () => <ArControlsTool rangeParams={params} /> },
      ]}
    />
  );
}

export function OwnersPage({ fromDate, toDate, params }) {
  const { t } = useFinLocale();
  return (
    <Tabs
      tabs={[
        { id: 'statements', label: t('pms.fin.nav.tabs.statements'), render: () => <OwnerStatementsTab fromDate={fromDate} toDate={toDate} rangeParams={params} /> },
        { id: 'trust', label: t('pms.fin.nav.tabs.trust'), render: () => <OwnerTrustTool rangeParams={params} /> },
      ]}
    />
  );
}

export function StatementsPage({ params }) {
  const { t } = useFinLocale();
  return (
    <Tabs
      tabs={[
        { id: 'pnl', label: t('pms.fin.nav.tabs.pnl'), render: () => <ReportsTool rangeParams={params} /> },
        { id: 'cashflow', label: t('pms.fin.nav.tabs.cashflow'), render: () => <CashFlowTool rangeParams={params} /> },
        { id: 'segments', label: t('pms.fin.nav.tabs.segments'), render: () => <SegmentPnlTool rangeParams={params} /> },
      ]}
    />
  );
}

export function CalendarPage() {
  const { t } = useFinLocale();
  return (
    <Tabs
      tabs={[
        { id: 'calendar', label: t('pms.fin.nav.tabs.calendar'), render: () => <PaymentCalendarTool /> },
        { id: 'fixed', label: t('pms.fin.nav.tabs.fixed'), render: () => <FixedChargesSection /> },
      ]}
    />
  );
}

export function ReconcilePage({ params }) {
  const { t } = useFinLocale();
  return (
    <Tabs
      tabs={[
        { id: 'bank', label: t('pms.fin.nav.tabs.bank'), render: () => <BankRecTool rangeParams={params} /> },
        { id: 'card', label: t('pms.fin.nav.tabs.card'), render: () => <GatewayTool rangeParams={params} /> },
      ]}
    />
  );
}

/* ---------- Close month with automatic blockers ---------- */

export function ClosePage({ toDate }) {
  const { t } = useFinLocale();
  const { openTool } = useWorkspace();
  const today = useToday();
  const health = useHealth();
  const byId = Object.fromEntries((today.data?.items || []).map((i) => [i.id, i]));
  const checkBy = Object.fromEntries((health.data?.checks || []).map((c) => [c.id, c]));
  const steps = [
    { id: 'bank', done: !checkBy.bank_not_reconciled?.count, tool: 'reconcile', count: checkBy.bank_not_reconciled?.count },
    { id: 'collection', done: !byId.collection, tool: 'collection', count: byId.collection?.count },
    { id: 'refunds', done: !byId.refunds, tool: 'refunds', count: byId.refunds?.count },
    { id: 'calendar', done: !byId.calendar_overdue, tool: 'calendar', count: byId.calendar_overdue?.count },
    { id: 'outstanding', done: !byId.left_owing, tool: 'outstanding', count: byId.left_owing?.count },
    { id: 'health', done: !(health.data?.issues), tool: 'health', count: health.data?.issues },
  ];
  const ready = steps.every((s) => s.done);
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-soul-line bg-white p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-soul-blue">{t('pms.fin.closeSteps.title')}</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
            {ready ? t('pms.fin.closeSteps.ready') : t('pms.fin.closeSteps.notReady', { count: steps.filter((s) => !s.done).length })}
          </span>
        </div>
        <ol className="space-y-2">
          {steps.map((s, i) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-soul-line/70 px-4 py-2.5">
              <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${s.done ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-gray-600'}`}>
                {s.done ? '✓' : i + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{t(`pms.fin.closeSteps.steps.${s.id}`)}</span>
                {!s.done && s.count ? <span className="text-gray-500"> · {t('pms.fin.closeSteps.left', { count: s.count })}</span> : null}
              </span>
              {!s.done ? (
                <button type="button" className="btn-secondary !px-3 !py-1 text-xs" onClick={() => openTool(s.tool)}>
                  {t('pms.fin.closeSteps.fix')}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-gray-500">{t('pms.fin.closeSteps.hint')}</p>
      </section>
      <CloseTool toDate={toDate} />
    </div>
  );
}
