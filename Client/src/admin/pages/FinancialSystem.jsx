import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  ArrowLeft,
  Banknote,
  BookOpen,
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  Globe,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  Lock,
  PenLine,
  Receipt,
  Scale,
  Shield,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { getAccount } from '../../lib/finance/chartOfAccounts';
import { FinLocaleProvider, useFinLocale } from '../context/FinLocaleContext';
import { PettyCashSection } from './PettyCash';
import {
  DateFilters,
  ExportPeriodModal,
  GROUP_META,
  cairoYearMonth,
  monthBounds,
  rangeParams,
  useCustomAccounts,
  useFinanceNav,
} from './finance/shared';
import { AccountView, GroupView, TransactionView } from './finance/accounts';
import { TaxTab } from './finance/tax';
import { ManualEntriesTab } from './finance/manual';
import { CashForecastTool } from './finance/reports';
import { CashReviewTool } from './finance/collection';
import { CancelRequestsTool } from './finance/refunds';
import { CheckinAuditTool } from './finance/checkinAudit';
import { InsuranceRefundsTool } from './finance/insurance';
import { VendorsTool } from './finance/vendors';
import { ReportBuilderPage } from './finance/reportBuilder';
import {
  AccountsPage,
  CalendarPage,
  ClosePage,
  HealthPage,
  OutstandingPage,
  OwnersPage,
  ReconcilePage,
  StatementsPage,
  TodayPage,
  useNavBadges,
} from './finance/pages';
import { GlobalSearch, WorkspaceProvider } from './finance/workspace';

/**
 * Pages grouped by job. `period: true` means the page follows the date filter, so the filter shows only there.
 * Old links (?tool=aging, ?tab=trust …) still land on the right page and tab through ALIASES.
 */
const NAV = [
  {
    id: 'today',
    items: [
      { id: 'today', icon: LayoutDashboard, period: true },
      { id: 'health', icon: HeartPulse },
    ],
  },
  {
    id: 'moneyIn',
    items: [
      { id: 'outstanding', icon: AlertCircle, period: true },
      { id: 'collection', icon: Banknote },
      { id: 'checkin-audit', icon: ClipboardList },
      { id: 'insurance', icon: Shield },
    ],
  },
  {
    id: 'moneyOut',
    items: [
      { id: 'refunds', icon: Receipt },
      { id: 'calendar', icon: CalendarDays },
      { id: 'vendors', icon: Users, period: true },
      { id: 'petty', icon: Wallet },
    ],
  },
  { id: 'owners', items: [{ id: 'owners', icon: Building2, period: true }] },
  {
    id: 'books',
    items: [
      { id: 'accounts', icon: BookOpen, period: true },
      { id: 'manual', icon: PenLine, period: true },
      { id: 'reconcile', icon: Landmark, period: true },
      { id: 'close', icon: Lock },
    ],
  },
  {
    id: 'reports',
    items: [
      { id: 'statements', icon: FileSpreadsheet, period: true },
      { id: 'builder', icon: FileBarChart, period: true },
      { id: 'tax', icon: Scale, period: true },
      { id: 'forecast', icon: TrendingUp, period: true },
    ],
  },
];
const PAGES = Object.fromEntries(NAV.flatMap((g) => g.items.map((i) => [i.id, i])));
const ALIASES = {
  home: ['today'],
  aging: ['outstanding', 'owes'],
  ar: ['outstanding', 'followup'],
  'cash-review': ['collection'],
  'cancel-requests': ['refunds'],
  cancellations: ['refunds'],
  'payment-calendar': ['calendar', 'calendar'],
  'payments-calendar': ['calendar', 'calendar'],
  recurring: ['calendar', 'fixed'],
  trust: ['owners', 'trust'],
  settlements: ['owners', 'statements'],
  statement: ['owners', 'statements'],
  reports: ['statements', 'pnl'],
  cashflow: ['statements', 'cashflow'],
  segment: ['statements', 'segments'],
  gateway: ['reconcile', 'card'],
  bank: ['reconcile', 'bank'],
  expenses: ['manual'],
  'petty-cash': ['petty'],
  'expense-forecast': ['forecast'],
  checkins: ['checkin-audit'],
  'check-in-audit': ['checkin-audit'],
  assets: ['accounts'],
};

const PERIOD_KEY = 'soul_fin_period';
function loadPeriod() {
  try {
    const saved = JSON.parse(localStorage.getItem(PERIOD_KEY) || 'null');
    if (saved?.from) return { from: saved.from, to: saved.to || '', basis: saved.basis === 'created' ? 'created' : 'stay' };
  } catch {
    /* use the current month */
  }
  return { ...monthBounds(cairoYearMonth()), basis: 'stay' };
}

function Sidebar({ current, onPick, badges }) {
  const { t } = useFinLocale();
  return (
    <nav aria-label={t('pms.fin.nav.label')} className="space-y-4">
      {NAV.map((group) => (
        <div key={group.id}>
          <p className="mb-1 px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-gray-400">{t(`pms.fin.nav.groups.${group.id}`)}</p>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = current === item.id;
              const badge = badges[item.id];
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onPick(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-start text-sm ${active ? 'bg-soul-blue text-white' : 'text-gray-700 hover:bg-white'}`}
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-soul-blue'}`} />
                    <span className="min-w-0 flex-1 truncate">{t(`pms.fin.nav.pages.${item.id}`)}</span>
                    {badge ? (
                      <span className={`min-w-[20px] rounded-full px-1.5 text-center text-[11px] font-bold tabular-nums ${active ? 'bg-white text-soul-blue' : item.id === 'health' ? 'bg-rose-600 text-white' : 'bg-orange-500 text-white'}`}>
                        {badge > 99 ? '99+' : badge}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function FinancialSystemInner() {
  const { t, locale, toggleLocale, isRtl } = useFinLocale();
  const { view, group, code, txn, tool: rawTool, go, searchParams } = useFinanceNav();
  const [period, setPeriod] = useState(loadPeriod);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const { from: fromDate, to: toDate, basis } = period;
  const params = rangeParams(fromDate, toDate, basis);
  useCustomAccounts();
  const badges = useNavBadges();

  useEffect(() => {
    try {
      localStorage.setItem(PERIOD_KEY, JSON.stringify(period));
    } catch {
      /* the period simply resets next visit */
    }
  }, [period]);

  // Old links: ?tool=aging → Outstanding / Who owes, ?tab=trust → Owners / Trust …
  const legacyTab = searchParams.get('tab');
  const requested = rawTool || (legacyTab ? legacyTab : '');
  const alias = ALIASES[requested];
  const drill = Boolean(code || txn || (view === 'group' && group));
  const page = drill ? null : alias ? alias[0] : PAGES[requested] ? requested : 'today';
  useEffect(() => {
    if (alias && !drill) go({ tool: alias[0], tab: '', ...(alias[1] && !searchParams.get('sub') ? { sub: alias[1] } : {}) });
  }, [requested]); // eslint-disable-line react-hooks/exhaustive-deps

  const openTool = useCallback(
    (id, sub = '') => {
      const target = ALIASES[id] || [id, sub];
      go({ view: 'tool', tool: target[0], sub: sub || target[1] || '', group: '', code: '', txn: '', tab: '' });
      window.scrollTo({ top: 0 });
    },
    [go]
  );
  const openGroup = (id) => go({ view: 'group', group: id, code: '', txn: '', tool: '', sub: '' });
  const openAccount = (c) => go({ view: 'account', code: c, group: getAccount(c)?.group || '', txn: '', tool: '', sub: '' });

  // The portal (balances, treasuries, KPIs) is heavy: refresh when the tab regains focus, not on a timer.
  const usesPortal = drill || ['today', 'accounts'].includes(page);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-portal', fromDate, toDate, basis],
    queryFn: () => api.get('/financial-system/portal', { params }).then((r) => r.data),
    enabled: usesPortal,
    staleTime: 2 * 60_000,
  });

  function updatePeriod(patch) {
    setPeriod((prev) => {
      const next = { ...prev, ...patch };
      if (next.to && next.to < next.from) next.to = next.from;
      return next;
    });
  }

  async function exportReport(from, to) {
    try {
      setExporting(true);
      const res = await api.get('/financial-system/export', { params: rangeParams(from, to, basis), responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `soul-financial-system-${from}_to_${to}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(url);
      setExportOpen(false);
    } catch {
      toast.error(t('pms.fin.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const crumbs = useMemo(() => {
    const items = [{ label: t('pms.fin.title'), onClick: () => openTool('today') }];
    if (page) {
      items.push({ label: t(`pms.fin.nav.pages.${page}`) });
      return items;
    }
    items.push({ label: t('pms.fin.nav.pages.accounts'), onClick: () => openTool('accounts') });
    if (group) items.push({ label: GROUP_META[group]?.label || group, onClick: () => openGroup(group) });
    if (code) items.push({ label: getAccount(code)?.name || code, onClick: () => openAccount(code) });
    if (txn) items.push({ label: txn });
    return items;
  }, [page, group, code, txn, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const showPeriod = drill || Boolean(PAGES[page]?.period);
  const currentNav = page || 'accounts';

  let body;
  if (txn) body = <TransactionView txnId={txn} fromDate={fromDate} toDate={toDate} basis={basis} />;
  else if (code) {
    body = (
      <AccountView
        code={code}
        fromDate={fromDate}
        toDate={toDate}
        basis={basis}
        onOpenTxn={(id) => go({ view: 'txn', txn: id, code, group: getAccount(code)?.group || group })}
        onDeleted={() => openGroup(group || getAccount(code)?.group || 'assets')}
      />
    );
  } else if (view === 'group' && group) body = <GroupView groupId={group} data={data} onOpenAccount={openAccount} />;
  else if (page === 'today') {
    body = (
      <TodayPage
        data={data}
        isLoading={isLoading}
        period={period}
        onOpenGroup={openGroup}
        onOpenAccount={openAccount}
        onExport={() => setExportOpen(true)}
        exporting={exporting}
      />
    );
  } else if (page === 'health') body = <HealthPage />;
  else if (page === 'outstanding') body = <OutstandingPage params={params} onOpenAccount={openAccount} />;
  else if (page === 'collection') body = <CashReviewTool />;
  else if (page === 'checkin-audit') body = <CheckinAuditTool />;
  else if (page === 'insurance') body = <InsuranceRefundsTool onOpenAccount={openAccount} />;
  else if (page === 'refunds') body = <CancelRequestsTool />;
  else if (page === 'calendar') body = <CalendarPage />;
  else if (page === 'vendors') body = <VendorsTool rangeParams={params} />;
  else if (page === 'petty') body = <PettyCashSection embedded />;
  else if (page === 'owners') body = <OwnersPage fromDate={fromDate} toDate={toDate} params={params} />;
  else if (page === 'accounts') body = <AccountsPage data={data} isLoading={isLoading} onOpenGroup={openGroup} />;
  else if (page === 'manual') body = <ManualEntriesTab fromDate={fromDate} toDate={toDate} rangeParams={params} />;
  else if (page === 'reconcile') body = <ReconcilePage params={params} />;
  else if (page === 'close') body = <ClosePage toDate={toDate} />;
  else if (page === 'statements') body = <StatementsPage params={params} />;
  else if (page === 'tax') body = <TaxTab rangeParams={params} />;
  else if (page === 'forecast') body = <CashForecastTool rangeParams={params} />;
  else if (page === 'builder') body = <ReportBuilderPage params={params} />;
  else body = <LoadingSpinner />;

  return (
    <WorkspaceProvider openTool={openTool}>
      <div className="space-y-5" dir={isRtl ? 'rtl' : 'ltr'}>
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">{t('pms.fin.soulBooks')}</p>
            <h1 className="page-title flex items-center gap-2">
              <Landmark className="h-7 w-7 text-soul-blue" />
              {page ? t(`pms.fin.nav.pages.${page}`) : t('pms.fin.title')}
            </h1>
            <nav className="mt-1.5 flex flex-wrap items-center gap-1 text-sm" aria-label={t('pms.fin.nav.breadcrumbs')}>
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-gray-300 rtl:rotate-180" />}
                  {c.onClick ? (
                    <button type="button" className="text-soul-blue hover:underline" onClick={c.onClick}>
                      {c.label}
                    </button>
                  ) : (
                    <span className="text-gray-500">{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <GlobalSearch />
            <button type="button" onClick={toggleLocale} className="btn-secondary inline-flex items-center gap-1.5 text-sm">
              <Globe className="h-4 w-4" />
              {locale === 'en' ? 'العربية' : 'English'}
            </button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <label className="lg:hidden">
              <span className="sr-only">{t('pms.fin.nav.label')}</span>
              <select className="input w-full" value={currentNav} onChange={(e) => openTool(e.target.value)}>
                {NAV.map((g) => (
                  <optgroup key={g.id} label={t(`pms.fin.nav.groups.${g.id}`)}>
                    {g.items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {t(`pms.fin.nav.pages.${i.id}`)}
                        {badges[i.id] ? ` (${badges[i.id]})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="hidden max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl border border-soul-line bg-slate-50/70 p-2 lg:block">
              <Sidebar current={currentNav} onPick={(id) => openTool(id)} badges={badges} />
            </div>
          </aside>

          <main className="min-w-0 space-y-4">
            {showPeriod || drill ? (
              <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-soul-line bg-white px-4 py-3">
                {drill ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-sm text-soul-blue"
                    onClick={() => {
                      if (txn) return go({ view: 'account', txn: '', code, group });
                      if (code) return openGroup(getAccount(code)?.group || group || 'assets');
                      return openTool('accounts');
                    }}
                  >
                    <ArrowLeft className="h-4 w-4 rtl:rotate-180" /> {t('pms.fin.back')}
                  </button>
                ) : (
                  <p className="text-xs text-gray-500">{t('pms.fin.nav.periodHint')}</p>
                )}
                {showPeriod ? <DateFilters fromDate={fromDate} toDate={toDate} basis={basis} onChange={updatePeriod} /> : null}
              </div>
            ) : null}
            {body}
          </main>
        </div>

        <ExportPeriodModal
          key={exportOpen ? `export-${fromDate}-${toDate}` : 'export-closed'}
          open={exportOpen}
          defaultFrom={fromDate}
          defaultTo={toDate}
          exporting={exporting}
          onClose={() => setExportOpen(false)}
          onConfirm={exportReport}
        />
      </div>
    </WorkspaceProvider>
  );
}

export default function FinancialSystem() {
  return (
    <FinLocaleProvider>
      <FinancialSystemInner />
    </FinLocaleProvider>
  );
}
