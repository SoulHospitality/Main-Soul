import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  CalendarDays,
  Landmark,
  Scale,
  Wallet,
  Banknote,
  Coins,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Download,
  CheckCircle2,
  PenLine,
  Plus,
  Trash2,
  BookOpen,
  PiggyBank,
  Shield,
  TrendingUp,
  Receipt,
  CircleDollarSign,
  CreditCard,
  Home,
  Zap,
  UtensilsCrossed,
  Users,
  AlertCircle,
  Settings2,
  FileSpreadsheet,
  Lock,
  Unlock,
  Building2,
  Globe,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import BankAccountPicker from '../../components/BankAccountPicker';
import { currency, formatDate, formatDateTime } from '../../utils/formatters';
import { FINANCE_BOOKS_START as FINANCIAL_EPOCH } from '../../utils/financialEpoch';
import {
  ACCOUNT_GROUPS,
  CHART_OF_ACCOUNTS,
  getAccount,
  isBuiltinAccount,
  setCustomAccounts,
  treasuryCodes,
} from '../../../lib/finance/chartOfAccounts';
import { VAT_OUTPUT_PCT, WHT_STANDARD_PCT, WHT_REDUCED_PCT } from '../../../lib/finance/taxEngine';
import { PettyCashSection } from '../PettyCash';
import { RefundApprovalSteps, refundReady } from '../../components/RefundApprovals';
import { FinLocaleProvider, useFinLocale } from '../../context/FinLocaleContext';
import { SmartTable } from './DataTable';
import { AccountLines, rangeParams } from './shared';

export function CashFlowSection({ cf, fromDate, toDate }) {
  const { t } = useFinLocale();
  const [expanded, setExpanded] = useState({});

  function toggle(key) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function lineLabel(line) {
    const key = `pms.fin.reports.cfLines.${line.id}`;
    const translated = t(key);
    return translated === key ? line.label || line.id : translated;
  }

  function SectionBlock({ title, section, sectionKey }) {
    const lines = section?.lines || [];
    return (
      <div className="space-y-1">
        <div className="px-4 py-2 bg-slate-50 border-b font-semibold text-sm text-soul-blue">
          {title}
        </div>
        {lines.length === 0 ? (
          <p className="px-4 py-2 text-xs text-gray-400">{t('pms.fin.reports.cfNoActivity')}</p>
        ) : (
          lines.map((line) => {
            const key = `${sectionKey}:${line.id}`;
            const open = Boolean(expanded[key]);
            return (
              <div key={key} className="border-b border-soul-line/60 last:border-0">
                <button
                  type="button"
                  className="w-full flex justify-between items-center gap-3 px-4 py-2 text-sm hover:bg-soul-blue-50/40 text-left"
                  onClick={() => toggle(key)}
                >
                  <span className="flex items-center gap-2">
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                    {lineLabel(line)}
                    {line.entries?.length ? (
                      <span className="text-[10px] text-gray-400">({line.entries.length})</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums font-medium">{currency(line.amount)}</span>
                </button>
                {open && line.entries?.length ? (
                  <div className="bg-gray-50/80 px-4 py-2 space-y-1">
                    {line.entries.map((e) => (
                      <div
                        key={`${e.id}-${e.amount}-${e.date}`}
                        className="flex justify-between gap-3 text-xs text-gray-600"
                      >
                        <span className="min-w-0 truncate">
                          <span className="text-gray-400 mr-2">{formatDate(e.date)}</span>
                          {e.description}
                        </span>
                        <span className="tabular-nums shrink-0">{currency(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        )}
        <div className="flex justify-between px-4 py-2.5 text-sm font-semibold border-t">
          <span>{t('pms.fin.reports.cfSectionTotal', { section: title })}</span>
          <span className="tabular-nums">{currency(section?.total)}</span>
        </div>
      </div>
    );
  }

  const balanced = cf.reconciliation?.balanced !== false;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-soul-line bg-white p-5 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-soul-blue">{t('pms.fin.reports.cfTitle')}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {t('pms.fin.reports.cfMethodHint', {
                from: fromDate || cf.from_date,
                to: toDate || cf.to_date,
              })}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <div className="rounded-xl border border-soul-line bg-slate-50/80 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('pms.fin.reports.cfOpening')}</p>
            <p className="text-lg font-bold tabular-nums mt-1">{currency(cf.opening_cash)}</p>
          </div>
          <div className="rounded-xl border border-soul-line bg-white p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('pms.fin.reports.cfNetChange')}</p>
            <p className="text-lg font-bold tabular-nums mt-1">{currency(cf.net_change)}</p>
          </div>
          <div
            className={`rounded-xl border p-3 ${
              balanced ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/60'
            }`}
          >
            <p className="text-[11px] uppercase tracking-wide text-gray-400">{t('pms.fin.reports.cfEnding')}</p>
            <p className="text-lg font-bold tabular-nums mt-1">{currency(cf.ending_cash)}</p>
            {!balanced ? (
              <p className="text-[11px] text-rose-700 mt-1">
                {t('pms.fin.reports.cfVariance', {
                  amount: currency(cf.reconciliation?.variance),
                })}
              </p>
            ) : (
              <p className="text-[11px] text-emerald-700 mt-1">{t('pms.fin.reports.cfReconciled')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <SectionBlock
          title={t('pms.fin.reports.cfOperating')}
          section={cf.operating}
          sectionKey="operating"
        />
        <SectionBlock
          title={t('pms.fin.reports.cfInvesting')}
          section={cf.investing}
          sectionKey="investing"
        />
        <SectionBlock
          title={t('pms.fin.reports.cfFinancing')}
          section={cf.financing}
          sectionKey="financing"
        />
        <div className="flex justify-between px-4 py-3 bg-soul-blue text-white font-semibold">
          <span>{t('pms.fin.reports.netTreasuryChange')}</span>
          <span className="tabular-nums">{currency(cf.net_change)}</span>
        </div>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-4 py-3 border-b font-semibold text-sm">{t('pms.fin.reports.cfByAccount')}</div>
        <SmartTable name="reports-1"><table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.reports.thAccount')}</th>
              <th className="text-right">{t('pms.fin.reports.cfOpening')}</th>
              <th className="text-right">{t('pms.fin.reports.cfInflows')}</th>
              <th className="text-right">{t('pms.fin.reports.cfOutflows')}</th>
              <th className="text-right">{t('pms.fin.reports.cfEnding')}</th>
            </tr>
          </thead>
          <tbody>
            {(cf.by_account || []).map((a) => (
              <tr key={a.code}>
                <td>
                  <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
                  {a.name}
                  {a.currency && a.currency !== 'EGP' ? (
                    <span className="text-[10px] text-gray-400 ml-1">({a.currency})</span>
                  ) : null}
                </td>
                <td className="text-right tabular-nums">{currency(a.opening)}</td>
                <td className="text-right tabular-nums text-emerald-700">{currency(a.inflows)}</td>
                <td className="text-right tabular-nums text-rose-700">{currency(a.outflows)}</td>
                <td className="text-right tabular-nums font-medium">{currency(a.closing)}</td>
              </tr>
            ))}
          </tbody>
        </table></SmartTable>
        <p className="px-4 py-2 text-[11px] text-gray-500 border-t">{cf.note}</p>
      </div>
    </div>
  );
}

export function CashFlowTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-reports', params],
    queryFn: () => api.get('/financial-system/reports', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.reports.cfPageHint', {
          from: data?.from_date,
          to: data?.to_date,
        })}
      </p>
      <CashFlowSection
        cf={data?.cash_flow || {}}
        fromDate={data?.from_date}
        toDate={data?.to_date}
      />
    </div>
  );
}

export function ReportsTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const [tab, setTab] = useState('pnl');
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-reports', params],
    queryFn: () => api.get('/financial-system/reports', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const pnl = data?.profit_and_loss || {};
  const tb = data?.trial_balance || {};
  const bs = data?.balance_sheet || {};
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.reports.description', { from: data?.from_date, to: data?.to_date })}
      </p>
      <div className="flex flex-wrap gap-2">
        {[
          ['pnl', t('pms.fin.reports.pnl')],
          ['tb', t('pms.fin.reports.tb')],
          ['bs', t('pms.fin.reports.bs')],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${tab === id ? 'bg-soul-blue text-white' : 'bg-white border border-soul-line'}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'pnl' && (
        <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold">{t('pms.fin.reports.pnlTitle')}</h3>
            <p className="text-xs text-gray-500">{t('pms.fin.reports.pnlHint')}</p>
          </div>
          <div className="px-6 py-3 bg-emerald-50 text-sm flex justify-between font-semibold">
            <span>{t('pms.fin.reports.grossRevenueLabel')}</span>
            <span className="tabular-nums">{currency(pnl.totals?.gross_revenue ?? pnl.receipts?.total)}</span>
          </div>
          <div className="px-6 py-1.5 text-sm flex justify-between text-gray-600">
            <span>{t('pms.fin.reports.reservationTotals')}</span>
            <span className="tabular-nums">{currency(pnl.receipts?.stays)}</span>
          </div>
          <div className="px-6 py-1.5 text-sm flex justify-between text-gray-600">
            <span>{t('pms.fin.reports.customRevenue')}</span>
            <span className="tabular-nums">{currency(pnl.receipts?.custom)}</span>
          </div>
          <div className="px-6 py-2 text-sm flex justify-between text-rose-800 bg-rose-50/70">
            <span>{t('pms.fin.reports.ownerShareLabel')}</span>
            <span className="tabular-nums">−{currency(pnl.totals?.owner_share ?? pnl.receipts?.owner_share)}</span>
          </div>
          <div className="px-6 py-2 text-sm flex justify-between font-semibold">
            <span>{t('pms.fin.reports.revenueAfterOwners')}</span>
            <span className="tabular-nums">{currency(pnl.totals?.net_revenue)}</span>
          </div>
          <AccountLines rows={(pnl.cogs || []).filter((a) => a.code !== '506000')} />
          <div className="px-6 py-2 bg-slate-50 text-sm flex justify-between">
            <span>{t('pms.fin.reports.grossAfterDirect')}</span>
            <span className="tabular-nums font-semibold">{currency(pnl.totals?.gross)}</span>
          </div>
          <AccountLines rows={pnl.opex} />
          <div className="px-6 py-3 bg-soul-blue text-white flex justify-between">
            <span>{t('pms.fin.reports.netProfitLoss')}</span>
            <span className="tabular-nums font-bold">{currency(pnl.totals?.net)}</span>
          </div>
        </div>
      )}
      {tab === 'tb' && (
        <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
          <SmartTable name="reports-2"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.reports.thAccount')}</th>
                <th className="text-right">{t('pms.fin.reports.thDebit')}</th>
                <th className="text-right">{t('pms.fin.reports.thCredit')}</th>
              </tr>
            </thead>
            <tbody>
              {(tb.rows || []).map((a) => (
                <tr key={a.code}>
                  <td>
                    <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
                    {a.name}
                  </td>
                  <td className="text-right tabular-nums">{a.debit ? currency(a.debit) : '—'}</td>
                  <td className="text-right tabular-nums">{a.credit ? currency(a.credit) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td>{t('pms.fin.reports.total')}</td>
                <td className="text-right tabular-nums">{currency(tb.debit)}</td>
                <td className="text-right tabular-nums">{currency(tb.credit)}</td>
              </tr>
            </tfoot>
          </table></SmartTable>
        </div>
      )}
      {tab === 'bs' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.reports.assets')}</div>
            <AccountLines rows={bs.assets} />
            <div className="px-6 py-3 bg-slate-50 flex justify-between font-semibold">
              <span>{t('pms.fin.reports.totalAssets')}</span>
              <span className="tabular-nums">{currency(bs.totals?.assets)}</span>
            </div>
          </div>
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.reports.liabilitiesEquity')}</div>
            <AccountLines rows={bs.liabilities} />
            <AccountLines rows={bs.equity} />
            <div className="px-6 py-3 bg-slate-50 flex justify-between font-semibold">
              <span>{t('pms.fin.reports.liabilitiesPlusEquity')}</span>
              <span className="tabular-nums">{currency(bs.totals?.liabilities_and_equity)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function SegmentPnlTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-segment-pnl', params],
    queryFn: () => api.get('/financial-system/segment-pnl', { params }).then((r) => r.data),
  });
  if (isLoading) return <LoadingSpinner />;
  const segments = data?.segments || [];
  const consolidated = data?.consolidated || {};

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.segment.description')}
      </p>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <SmartTable name="reports-3"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.segment.project')}</th>
                <th className="text-right">{t('pms.fin.segment.grossRevenue')}</th>
                <th className="text-right">{t('pms.fin.segment.ownerShare')}</th>
                <th className="text-right">{t('pms.fin.segment.netRevenue')}</th>
                <th className="text-right">{t('pms.fin.segment.directCosts')}</th>
                <th className="text-right">{t('pms.fin.segment.opexAlloc')}</th>
                <th className="text-right">{t('pms.fin.segment.netProfit')}</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.project}>
                  <td className="font-medium">{s.project}</td>
                  <td className="text-right tabular-nums">{currency(s.gross_revenue)}</td>
                  <td className="text-right tabular-nums">{currency(s.owner_share)}</td>
                  <td className="text-right tabular-nums">{currency(s.net_revenue)}</td>
                  <td className="text-right tabular-nums">{currency(s.direct_costs)}</td>
                  <td className="text-right tabular-nums">{currency(s.opex_allocation)}</td>
                  <td className={`text-right tabular-nums font-bold ${s.net_profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {currency(s.net_profit)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-50 font-semibold">
                <td>{consolidated.project}</td>
                <td className="text-right tabular-nums">{currency(consolidated.gross_revenue)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.owner_share)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.net_revenue)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.direct_costs)}</td>
                <td className="text-right tabular-nums">{currency(consolidated.opex_allocation)}</td>
                <td className={`text-right tabular-nums font-bold ${(consolidated.net_profit || 0) >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {currency(consolidated.net_profit)}
                </td>
              </tr>
            </tfoot>
          </table></SmartTable>
        </div>
      </div>
    </div>
  );
}

export function CashForecastTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-cash-forecast', params],
    queryFn: () => api.get('/financial-system/cash-forecast', { params }).then((r) => r.data),
  });
  const [editWeek, setEditWeek] = useState(null);
  const [editForm, setEditForm] = useState({ category: 'collections', amount: '', notes: '' });

  const addEntry = useMutation({
    mutationFn: (payload) => api.post('/financial-system/cash-forecast', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.forecast.entryAdded'));
      qc.invalidateQueries({ queryKey: ['financial-system-cash-forecast'] });
      setEditWeek(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const removeEntry = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/cash-forecast/${id}`),
    onSuccess: () => {
      toast.success(t('pms.fin.forecast.entryRemoved'));
      qc.invalidateQueries({ queryKey: ['financial-system-cash-forecast'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  if (isLoading) return <LoadingSpinner />;
  const weeks = data?.weeks || [];
  const startingBalance = data?.starting_balance || 0;

  const categories = [
    { value: 'collections', label: t('pms.fin.forecast.collections') },
    { value: 'owner_payouts', label: t('pms.fin.forecast.ownerPayouts') },
    { value: 'vendor_payments', label: t('pms.fin.forecast.vendorPayments') },
    { value: 'recurring', label: t('pms.fin.forecast.recurring') },
    { value: 'payroll', label: t('pms.fin.forecast.payroll') },
    { value: 'tax', label: t('pms.fin.forecast.taxCol') },
    { value: 'other_in', label: t('pms.fin.forecast.otherIn') },
    { value: 'other_out', label: t('pms.fin.forecast.otherOut') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500">
          {t('pms.fin.forecast.description', { balance: currency(startingBalance) })}
        </p>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <SmartTable name="reports-4"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.forecast.week')}</th>
                <th className="text-right">{t('pms.fin.forecast.collections')}</th>
                <th className="text-right">{t('pms.fin.forecast.ownerPayouts')}</th>
                <th className="text-right">{t('pms.fin.forecast.vendor')}</th>
                <th className="text-right">{t('pms.fin.forecast.recurring')}</th>
                <th className="text-right">{t('pms.fin.forecast.payroll')}</th>
                <th className="text-right">{t('pms.fin.forecast.taxCol')}</th>
                <th className="text-right">{t('pms.fin.forecast.other')}</th>
                <th className="text-right">{t('pms.fin.forecast.netFlow')}</th>
                <th className="text-right">{t('pms.fin.forecast.cumulative')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {weeks.map((w, i) => (
                <tr key={w.week_start} className={w.cumulative_balance < 0 ? 'bg-rose-50' : ''}>
                  <td className="font-medium text-xs whitespace-nowrap">{w.week_start}</td>
                  <td className="text-right tabular-nums text-emerald-700">{currency(w.collections)}</td>
                  <td className="text-right tabular-nums">{currency(w.owner_payouts)}</td>
                  <td className="text-right tabular-nums">{currency(w.vendor_payments)}</td>
                  <td className="text-right tabular-nums">{currency(w.recurring)}</td>
                  <td className="text-right tabular-nums">{currency(w.payroll)}</td>
                  <td className="text-right tabular-nums">{currency(w.tax)}</td>
                  <td className="text-right tabular-nums">{w.other_in > 0 ? `+${currency(w.other_in)}` : ''}{w.other_out > 0 ? ` −${currency(w.other_out)}` : ''}</td>
                  <td className={`text-right tabular-nums font-semibold ${w.net_flow >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {currency(w.net_flow)}
                  </td>
                  <td className={`text-right tabular-nums font-bold ${w.cumulative_balance >= 0 ? '' : 'text-rose-700'}`}>
                    {currency(w.cumulative_balance)}
                  </td>
                  <td className="text-right">
                    <button type="button" className="text-xs text-soul-blue" onClick={() => { setEditWeek(w.week_start); setEditForm({ category: 'collections', amount: '', notes: '' }); }}>
                      <Plus className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></SmartTable>
        </div>
      </div>

      <Modal open={Boolean(editWeek)} onClose={() => setEditWeek(null)} title={t('pms.fin.forecast.addForecast', { week: editWeek })} size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setEditWeek(null)}>{t('pms.fin.cancel')}</button>
            <button type="button" className="btn-primary" disabled={addEntry.isPending}
              onClick={() => addEntry.mutate({ week_start: editWeek, category: editForm.category, amount: parseFloat(editForm.amount), notes: editForm.notes || undefined })}>
              {t('pms.fin.forecast.add')}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <select className="input w-full" value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <input type="number" className="input w-full" placeholder={t('pms.fin.amount')} value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} />
          <input className="input w-full" placeholder={t('pms.fin.notes')} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      </Modal>
    </div>
  );
}
