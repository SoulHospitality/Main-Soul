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
import DataTable, { SmartTable } from './DataTable';
import { TimelineLink, useWorkspace } from './workspace';
import { ACTION_TYPE_KEYS, BANK_METHODS, CASH_REVIEW_METHODS, rangeParams } from './shared';

export function AgingDetail({ row }) {
  const { t } = useFinLocale();
  const lines = [
    [t('pms.fin.aging.accommodation', { nights: row.nights || 0, rate: currency(row.price_per_night) }), row.accommodation],
    [t('pms.fin.aging.housekeeping'), row.housekeeping],
    [t('pms.fin.aging.beach'), row.beach],
    [t('pms.fin.aging.insurance'), row.insurance],
  ].filter(([, v]) => Number(v) > 0);
  return (
    <div className="grid gap-4 bg-soul-blue-50/30 px-6 py-4 text-sm md:grid-cols-2">
      <div className="space-y-1">
        {lines.map(([label, v]) => (
          <div key={label} className="flex justify-between gap-4">
            <span className="text-gray-500">{label}</span>
            <span className="tabular-nums">{currency(v)}</span>
          </div>
        ))}
        <div className="flex justify-between gap-4 border-t border-soul-line pt-1 font-medium">
          <span>{t('pms.fin.aging.fullBill')}</span>
          <span className="tabular-nums">{currency(row.full_bill)}</span>
        </div>
        {row.owner_collected > 0 && (
          <div className="flex justify-between gap-4">
            <span className="text-gray-500">
              {t('pms.fin.aging.ownerCollected')}
              {row.owner_collected_type ? ` (${row.owner_collected_type})` : ''}
            </span>
            <span className="tabular-nums">− {currency(row.owner_collected)}</span>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <span className="text-gray-500">{t('pms.fin.aging.paid')}</span>
          <span className="tabular-nums text-emerald-700">− {currency(row.paid)}</span>
        </div>
        <div className="flex justify-between gap-4 border-t border-soul-line pt-1 font-semibold text-red-600">
          <span>{t('pms.fin.aging.toCollect')}</span>
          <span className="tabular-nums">{currency(row.amount)}</span>
        </div>
      </div>
      <div className="space-y-1 text-gray-600">
        <p>{t('pms.fin.aging.stay', { from: formatDate(row.check_in), to: formatDate(row.check_out) })}</p>
        {row.project ? <p>{row.project}</p> : null}
        {row.guest_phone ? <p className="tabular-nums">{row.guest_phone}</p> : null}
        {row.sales_person ? <p>{t('pms.fin.aging.sales', { name: row.sales_person })}</p> : null}
        {row.payment_status ? <p>{t('pms.fin.aging.paymentStatus', { status: row.payment_status })}</p> : null}
        <a
          href={`/admin/reservations?search=${encodeURIComponent(row.guest_name || '')}`}
          className="inline-flex items-center gap-1 font-medium text-soul-blue hover:underline"
        >
          {t('pms.fin.aging.openReservation')} <ChevronRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

/** The button on an outstanding stay: collect the rest, or hand money already recorded to the finance agent. */
export function AgingCollectButton({ row, onCollect, onSend, sending }) {
  const { t } = useFinLocale();
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };
  if (row.with_finance) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
        {t('pms.fin.aging.withFinance', { amount: currency(row.pending_amount) })}
      </span>
    );
  }
  if (row.pending_payments?.length) {
    return (
      <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs whitespace-nowrap" disabled={sending} onClick={stop(onSend)}>
        {t('pms.fin.aging.sendToFinance', { amount: currency(row.pending_amount) })}
      </button>
    );
  }
  return (
    <button type="button" className="btn-primary !px-2.5 !py-1 text-xs whitespace-nowrap" onClick={stop(onCollect)}>
      {t('pms.fin.aging.collect')}
    </button>
  );
}

export function AgingCollectModal({ row, onClose }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    amount: String(row.amount),
    payment_method: 'cash',
    bank_account: '',
    payment_date: new Date().toISOString().slice(0, 10),
    reference_number: '',
    notes: '',
  });
  const save = useMutation({
    mutationFn: () =>
      api
        .post(`/financial-system/aging/${row.reservation_id}/collect`, {
          ...form,
          bank_account: BANK_METHODS.includes(form.payment_method) ? form.bank_account : null,
        })
        .then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res.sent_to_finance ? t('pms.fin.aging.sentToFinance') : t('pms.fin.aging.collected'));
      qc.invalidateQueries({ queryKey: ['financial-system-aging'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-cash-review'] });
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.aging.collectFailed')),
  });
  const amount = Number(form.amount) || 0;
  const tooMuch = amount > row.amount + 0.009;
  return (
    <Modal
      open
      onClose={onClose}
      title={t('pms.fin.aging.collectTitle', { name: row.guest_name || '' })}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('pms.fin.aging.cancel')}</button>
          <button
            type="button"
            className="btn-primary"
            disabled={save.isPending || !(amount > 0) || tooMuch || (BANK_METHODS.includes(form.payment_method) && !form.bank_account)}
            onClick={() => save.mutate()}
          >
            {save.isPending ? t('pms.fin.aging.collecting') : t('pms.fin.aging.collectConfirm', { amount: currency(amount) })}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-gray-600">
          {row.unit_name} · {formatDate(row.check_in)} → {formatDate(row.check_out)}
          <div className="mt-1 font-semibold text-red-600">{t('pms.fin.aging.toCollect')}: {currency(row.amount)}</div>
        </div>
        <div>
          <label className="label">{t('pms.fin.cashReview.amountReceived')}</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="input w-full"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
          {tooMuch ? <p className="mt-1 text-xs text-red-600">{t('pms.fin.aging.tooMuch', { amount: currency(row.amount) })}</p> : null}
        </div>
        <div>
          <p className="label">{t('pms.fin.cashReview.paymentMethod')}</p>
          <div className="grid grid-cols-3 gap-2">
            {CASH_REVIEW_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setForm((f) => ({ ...f, payment_method: m }))}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                  form.payment_method === m
                    ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                    : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
                }`}
              >
                {t(`pms.fin.cashReview.methods.${m}`)}
              </button>
            ))}
          </div>
        </div>
        {BANK_METHODS.includes(form.payment_method) ? (
          <BankAccountPicker
            label={t('pms.fin.cashReview.bankAccount')}
            value={form.bank_account}
            onChange={(v) => setForm((f) => ({ ...f, bank_account: v }))}
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{t('pms.fin.aging.paymentDate')}</label>
            <input type="date" className="input w-full" value={form.payment_date} onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">{t('pms.fin.aging.reference')}</label>
            <input className="input w-full" value={form.reference_number} onChange={(e) => setForm((f) => ({ ...f, reference_number: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="label">{t('pms.fin.cashReview.note')}</label>
          <textarea className="input w-full min-h-[60px]" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
    </Modal>
  );
}

export function AgingTool({ rangeParams: params, onOpenAccount }) {
  const { t } = useFinLocale();
  const { openTimeline } = useWorkspace();
  const qc = useQueryClient();
  const [openRow, setOpenRow] = useState(null);
  const [collecting, setCollecting] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-aging', params],
    queryFn: () => api.get('/financial-system/aging', { params }).then((r) => r.data),
  });
  const sendToFinance = useMutation({
    mutationFn: (row) => api.post(`/financial-system/aging/${row.reservation_id}/collect`, {}).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res.already_with_finance ? t('pms.fin.aging.alreadyWithFinance') : t('pms.fin.aging.sentToFinance'));
      qc.invalidateQueries({ queryKey: ['financial-system-aging'] });
      qc.invalidateQueries({ queryKey: ['financial-system-cash-review'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.aging.collectFailed')),
  });
  if (isLoading) return <LoadingSpinner />;
  const buckets = data?.buckets || {};
  const allRows = Object.entries(buckets).flatMap(([key, bucket]) => (bucket.rows || []).map((r) => ({ ...r, bucket: key })));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500">
          {t('pms.fin.aging.description', { balance: currency(data?.ar_balance) })}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => onOpenAccount('105000')}>
          {t('pms.fin.aging.openAccount')}
        </button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {Object.entries(buckets).map(([key, b]) => (
          <div key={key} className="rounded-2xl border border-soul-line bg-white p-4">
            <p className="text-xs text-gray-400">{b.label}</p>
            <p className="text-xl font-bold tabular-nums mt-1">{currency(b.amount)}</p>
            <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: b.count })}</p>
          </div>
        ))}
      </div>
      <DataTable
        rows={allRows}
        rowKey={(r) => r.reservation_id}
        exportName="outstanding"
        onRowClick={(r) => openTimeline(r.reservation_id)}
        initialSort={{ key: 'days', dir: 'desc' }}
        emptyText={t('pms.fin.aging.empty')}
        filters={Object.entries(buckets).map(([key, bucket]) => ({ id: key, label: bucket.label, test: (r) => r.bucket === key }))}
        columns={[
          { key: 'guest_name', label: t('pms.fin.aging.guest'), render: (r) => <TimelineLink id={r.reservation_id}>{r.guest_name}</TimelineLink> },
          { key: 'unit_name', label: t('pms.fin.aging.unit'), nowrap: true },
          { key: 'guest_phone', label: t('pms.fin.table.phone'), render: (r) => <span className="text-xs tabular-nums text-gray-500">{r.guest_phone || ''}</span> },
          { key: 'check_in', label: t('pms.fin.aging.checkIn'), nowrap: true, render: (r) => formatDate(r.check_in) },
          { key: 'days', label: t('pms.fin.aging.days'), align: 'end' },
          { key: 'full_bill', label: t('pms.fin.aging.fullBill'), align: 'end', money: true, total: true },
          { key: 'paid', label: t('pms.fin.aging.paid'), align: 'end', money: true, total: true, render: (r) => <span className="text-emerald-700">{currency(r.paid)}</span> },
          { key: 'amount', label: t('pms.fin.aging.toCollect'), align: 'end', money: true, total: true, render: (r) => <span className="font-semibold text-red-600">{currency(r.amount)}</span> },
          {
            key: 'action',
            label: '',
            sortable: false,
            noExport: true,
            value: () => '',
            render: (r) => (
              <span onClick={(e) => e.stopPropagation()}>
                <AgingCollectButton row={r} onCollect={() => setCollecting(r)} onSend={() => sendToFinance.mutate(r)} sending={sendToFinance.isPending} />
              </span>
            ),
          },
        ]}
      />
      {collecting ? <AgingCollectModal row={collecting} onClose={() => setCollecting(null)} /> : null}
    </div>
  );
}

export function ArControlsTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const [tab, setTab] = useState('dashboard');
  const qc = useQueryClient();

  const actionTypes = ACTION_TYPE_KEYS.map((at) => ({
    value: at.value,
    label: t(`pms.fin.ar.${at.labelKey}`),
  }));
  const actionTypeLabel = (type) =>
    actionTypes.find((at) => at.value === type)?.label || String(type || '').replace(/_/g, ' ');

  // ── Dashboard ──
  const { data: dash, isLoading: dashLoading } = useQuery({
    queryKey: ['ar-dashboard', params],
    queryFn: () => api.get('/financial-system/ar-dashboard', { params }).then((r) => r.data),
    enabled: tab === 'dashboard',
  });

  // ── Collection log ──
  const { data: actions = [], isLoading: actionsLoading } = useQuery({
    queryKey: ['ar-actions'],
    queryFn: () => api.get('/financial-system/ar-actions').then((r) => r.data),
    enabled: tab === 'log',
  });
  const [showActionForm, setShowActionForm] = useState(false);
  const [actionForm, setActionForm] = useState({ reservation_id: '', action_type: 'reminder_sent', notes: '', next_action_date: '', amount_disputed: '' });
  const createAction = useMutation({
    mutationFn: (payload) => api.post('/financial-system/ar-actions', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.actionLogged'));
      qc.invalidateQueries({ queryKey: ['ar-actions'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
      setShowActionForm(false);
      setActionForm({ reservation_id: '', action_type: 'reminder_sent', notes: '', next_action_date: '', amount_disputed: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // ── Provisions ──
  const { data: provisions = [], isLoading: provLoading } = useQuery({
    queryKey: ['ar-provisions'],
    queryFn: () => api.get('/financial-system/ar-provisions').then((r) => r.data),
    enabled: tab === 'provisions',
  });
  const [showProvForm, setShowProvForm] = useState(false);
  const [provForm, setProvForm] = useState({ period_month: new Date().toISOString().slice(0, 7), bucket_0_30_pct: '0', bucket_31_60_pct: '1', bucket_61_90_pct: '5', bucket_90_plus_pct: '20', notes: '' });
  const calcProvision = useMutation({
    mutationFn: (payload) => api.post('/financial-system/ar-provisions', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.provisionCalculated'));
      qc.invalidateQueries({ queryKey: ['ar-provisions'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
      setShowProvForm(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // ── Write-offs ──
  const { data: writeOffs = [], isLoading: woLoading } = useQuery({
    queryKey: ['ar-write-offs'],
    queryFn: () => api.get('/financial-system/ar-write-offs').then((r) => r.data),
    enabled: tab === 'writeoffs',
  });
  const [showWoForm, setShowWoForm] = useState(false);
  const [woForm, setWoForm] = useState({ reservation_id: '', amount: '', reason: '' });
  const createWo = useMutation({
    mutationFn: (payload) => api.post('/financial-system/ar-write-offs', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.writeOffProposedToast'));
      qc.invalidateQueries({ queryKey: ['ar-write-offs'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
      setShowWoForm(false);
      setWoForm({ reservation_id: '', amount: '', reason: '' });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const approveWo = useMutation({
    mutationFn: (id) => api.post(`/financial-system/ar-write-offs/${id}/approve`),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.writeOffApproved'));
      qc.invalidateQueries({ queryKey: ['ar-write-offs'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const rejectWo = useMutation({
    mutationFn: (id) => api.post(`/financial-system/ar-write-offs/${id}/reject`),
    onSuccess: () => {
      toast.success(t('pms.fin.ar.writeOffRejected'));
      qc.invalidateQueries({ queryKey: ['ar-write-offs'] });
      qc.invalidateQueries({ queryKey: ['ar-dashboard'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const tabs = [
    ['dashboard', t('pms.fin.ar.tabs.dashboard')],
    ['log', t('pms.fin.ar.tabs.log')],
    ['provisions', t('pms.fin.ar.tabs.provisions')],
    ['writeoffs', t('pms.fin.ar.tabs.writeoffs')],
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.ar.description')}
      </p>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([id, label]) => (
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

      {/* ── Dashboard ── */}
      {tab === 'dashboard' && (dashLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-soul-line bg-white p-4">
              <p className="text-xs text-gray-400">{t('pms.fin.ar.totalAr')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{currency(dash?.total_ar)}</p>
            </div>
            <div className="rounded-2xl border border-soul-line bg-white p-4">
              <p className="text-xs text-gray-400">{t('pms.fin.ar.badDebtProvision')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{currency(dash?.total_provision)}</p>
              {dash?.latest_provision && <p className="text-xs text-gray-500">{dash.latest_provision.period_month}</p>}
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
              <p className="text-xs text-amber-800">{t('pms.fin.ar.overdue')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{t('pms.fin.ar.overdueStays', { count: dash?.overdue_count || 0 })}</p>
              <p className="text-xs text-gray-500">{t('pms.fin.ar.overduePct', { pct: dash?.overdue_pct || 0 })}</p>
            </div>
            <div className="rounded-2xl border border-soul-line bg-white p-4">
              <p className="text-xs text-gray-400">{t('pms.fin.ar.actionsThisMonth')}</p>
              <p className="text-xl font-bold tabular-nums mt-1">{dash?.actions_this_month || 0}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(dash?.aging?.buckets || {}).map(([key, b]) => (
              <div key={key} className="rounded-2xl border border-soul-line bg-white p-4">
                <p className="text-xs text-gray-400">{b.label}</p>
                <p className="text-xl font-bold tabular-nums mt-1">{currency(b.amount)}</p>
                <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: b.count })}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-soul-line bg-white p-5">
              <h3 className="font-semibold mb-3">{t('pms.fin.ar.collectionActionsByType')}</h3>
              {Object.entries(dash?.action_counts || {}).length === 0 ? (
                <p className="text-sm text-gray-400">{t('pms.fin.ar.noCollectionActions')}</p>
              ) : (
                <div className="space-y-2">
                  {Object.entries(dash?.action_counts || {}).map(([type, cnt]) => (
                    <div key={type} className="flex justify-between text-sm">
                      <span>{actionTypeLabel(type)}</span>
                      <span className="font-semibold tabular-nums">{cnt}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="rounded-2xl border border-soul-line bg-white p-5">
              <h3 className="font-semibold mb-3">{t('pms.fin.ar.writeOffSummary')}</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>{t('pms.fin.ar.pendingWo')}</span>
                  <span className="font-semibold tabular-nums">{currency(dash?.write_offs?.pending)} ({dash?.write_offs?.pending_count || 0})</span>
                </div>
                <div className="flex justify-between">
                  <span>{t('pms.fin.ar.approvedWo')}</span>
                  <span className="font-semibold tabular-nums text-emerald-700">{currency(dash?.write_offs?.approved)} ({dash?.write_offs?.approved_count || 0})</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}

      {/* ── Collection log ── */}
      {tab === 'log' && (actionsLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={() => setShowActionForm(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.ar.logAction')}
            </button>
          </div>
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <SmartTable name="receivables-1"><table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('pms.fin.manual.date')}</th>
                  <th>{t('pms.fin.ar.reservation')}</th>
                  <th>{t('pms.fin.ar.typeCol')}</th>
                  <th>{t('pms.fin.notes')}</th>
                  <th>{t('pms.fin.ar.nextAction')}</th>
                  <th>{t('pms.fin.ar.by')}</th>
                </tr>
              </thead>
              <tbody>
                {actions.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-8">{t('pms.fin.ar.noCollectionLog')}</td></tr>
                ) : actions.map((a) => (
                  <tr key={a.id}>
                    <td>{formatDate(a.created_at)}</td>
                    <td className="tabular-nums">#{a.reservation_id}</td>
                    <td>{actionTypeLabel(a.action_type)}</td>
                    <td className="max-w-xs truncate">{a.notes || '—'}</td>
                    <td>{a.next_action_date ? formatDate(a.next_action_date) : '—'}</td>
                    <td>{a.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></SmartTable>
          </div>
          <Modal open={showActionForm} onClose={() => setShowActionForm(false)} title={t('pms.fin.ar.logActionTitle')} footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setShowActionForm(false)}>{t('pms.fin.cancel')}</button>
              <button type="submit" form="ar-action-form" className="btn-primary" disabled={createAction.isPending}>{t('pms.fin.save')}</button>
            </>
          }>
            <form id="ar-action-form" className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              createAction.mutate({
                reservation_id: parseInt(actionForm.reservation_id, 10),
                action_type: actionForm.action_type,
                notes: actionForm.notes || undefined,
                next_action_date: actionForm.next_action_date || undefined,
                amount_disputed: parseFloat(actionForm.amount_disputed) || 0,
              });
            }}>
              <div>
                <label className="label">{t('pms.fin.ar.reservationId')}</label>
                <input type="number" className="input w-full" required value={actionForm.reservation_id} onChange={(e) => setActionForm((f) => ({ ...f, reservation_id: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('pms.fin.ar.actionType')}</label>
                <select className="input w-full" value={actionForm.action_type} onChange={(e) => setActionForm((f) => ({ ...f, action_type: e.target.value }))}>
                  {actionTypes.map((at) => <option key={at.value} value={at.value}>{at.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">{t('pms.fin.notes')}</label>
                <textarea className="input w-full min-h-[80px]" value={actionForm.notes} onChange={(e) => setActionForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.ar.nextActionDate')}</label>
                  <input type="date" className="input w-full" value={actionForm.next_action_date} onChange={(e) => setActionForm((f) => ({ ...f, next_action_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.amountDisputed')}</label>
                  <input type="number" min="0" step="0.01" className="input w-full" value={actionForm.amount_disputed} onChange={(e) => setActionForm((f) => ({ ...f, amount_disputed: e.target.value }))} />
                </div>
              </div>
            </form>
          </Modal>
        </div>
      ))}

      {/* ── Provisions ── */}
      {tab === 'provisions' && (provLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={() => setShowProvForm(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.ar.calculateProvision')}
            </button>
          </div>
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <SmartTable name="receivables-2"><table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('pms.fin.ar.monthCol')}</th>
                  <th className="text-right">{t('pms.fin.ar.totalArCol')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket0_30')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket31_60')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket61_90')}</th>
                  <th className="text-right">{t('pms.fin.ar.bucket90plus')}</th>
                  <th className="text-right">{t('pms.fin.ar.provisionCol')}</th>
                  <th>{t('pms.fin.ar.by')}</th>
                </tr>
              </thead>
              <tbody>
                {provisions.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-gray-400 py-8">{t('pms.fin.ar.noProvisions')}</td></tr>
                ) : provisions.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.period_month}</td>
                    <td className="text-right tabular-nums">{currency(p.total_ar)}</td>
                    <td className="text-right tabular-nums">{p.bucket_0_30_pct}%</td>
                    <td className="text-right tabular-nums">{p.bucket_31_60_pct}%</td>
                    <td className="text-right tabular-nums">{p.bucket_61_90_pct}%</td>
                    <td className="text-right tabular-nums">{p.bucket_90_plus_pct}%</td>
                    <td className="text-right tabular-nums font-bold">{currency(p.total_provision)}</td>
                    <td>{p.created_by_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table></SmartTable>
          </div>
          <Modal open={showProvForm} onClose={() => setShowProvForm(false)} title={t('pms.fin.ar.calcProvisionTitle')} footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setShowProvForm(false)}>{t('pms.fin.cancel')}</button>
              <button type="submit" form="ar-prov-form" className="btn-primary" disabled={calcProvision.isPending}>{t('pms.fin.ar.calculate')}</button>
            </>
          }>
            <form id="ar-prov-form" className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              calcProvision.mutate({
                period_month: provForm.period_month,
                bucket_0_30_pct: parseFloat(provForm.bucket_0_30_pct),
                bucket_31_60_pct: parseFloat(provForm.bucket_31_60_pct),
                bucket_61_90_pct: parseFloat(provForm.bucket_61_90_pct),
                bucket_90_plus_pct: parseFloat(provForm.bucket_90_plus_pct),
                notes: provForm.notes || undefined,
              });
            }}>
              <div>
                <label className="label">{t('pms.fin.ar.periodMonth')}</label>
                <input type="month" className="input w-full" required value={provForm.period_month} onChange={(e) => setProvForm((f) => ({ ...f, period_month: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.ar.bucket0_30loss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_0_30_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_0_30_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.bucket31_60loss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_31_60_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_31_60_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.bucket61_90loss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_61_90_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_61_90_pct: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.ar.bucket90plusLoss')}</label>
                  <input type="number" min="0" max="100" step="0.1" className="input w-full" value={provForm.bucket_90_plus_pct} onChange={(e) => setProvForm((f) => ({ ...f, bucket_90_plus_pct: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="label">{t('pms.fin.notes')}</label>
                <textarea className="input w-full min-h-[60px]" value={provForm.notes} onChange={(e) => setProvForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </form>
          </Modal>
        </div>
      ))}

      {/* ── Write-offs ── */}
      {tab === 'writeoffs' && (woLoading ? <LoadingSpinner /> : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button type="button" className="btn-primary text-sm" onClick={() => setShowWoForm(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.ar.proposeWriteOff')}
            </button>
          </div>
          <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
            <SmartTable name="receivables-3"><table className="table text-sm">
              <thead>
                <tr>
                  <th>{t('pms.fin.ar.reservation')}</th>
                  <th className="text-right">{t('pms.fin.amount')}</th>
                  <th>{t('pms.fin.ar.reasonCol')}</th>
                  <th>{t('pms.fin.ar.statusCol')}</th>
                  <th>{t('pms.fin.ar.by')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {writeOffs.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-8">{t('pms.fin.ar.noWriteOffs')}</td></tr>
                ) : writeOffs.map((w) => (
                  <tr key={w.id}>
                    <td className="tabular-nums">#{w.reservation_id}</td>
                    <td className="text-right tabular-nums font-medium">{currency(w.amount)}</td>
                    <td className="max-w-xs truncate">{w.reason || '—'}</td>
                    <td>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        w.status === 'approved' ? 'bg-emerald-100 text-emerald-800' :
                        w.status === 'rejected' ? 'bg-rose-100 text-rose-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {w.status}
                      </span>
                    </td>
                    <td>{w.created_by_name || '—'}</td>
                    <td className="text-right space-x-2">
                      {w.status === 'pending' && (
                        <>
                          <button type="button" className="text-xs text-emerald-700" onClick={() => approveWo.mutate(w.id)}>{t('pms.fin.approve')}</button>
                          <button type="button" className="text-xs text-rose-600" onClick={() => rejectWo.mutate(w.id)}>{t('pms.fin.reject')}</button>
                        </>
                      )}
                      {w.status === 'approved' && w.approved_by_name && (
                        <span className="text-xs text-gray-400">{t('pms.fin.ar.approvedBy', { name: w.approved_by_name })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></SmartTable>
          </div>
          <Modal open={showWoForm} onClose={() => setShowWoForm(false)} title={t('pms.fin.ar.proposeWriteOffTitle')} footer={
            <>
              <button type="button" className="btn-secondary" onClick={() => setShowWoForm(false)}>{t('pms.fin.cancel')}</button>
              <button type="submit" form="ar-wo-form" className="btn-primary" disabled={createWo.isPending}>{t('pms.fin.ar.propose')}</button>
            </>
          }>
            <form id="ar-wo-form" className="space-y-4" onSubmit={(e) => {
              e.preventDefault();
              createWo.mutate({
                reservation_id: parseInt(woForm.reservation_id, 10),
                amount: parseFloat(woForm.amount),
                reason: woForm.reason || undefined,
              });
            }}>
              <div>
                <label className="label">{t('pms.fin.ar.reservationId')}</label>
                <input type="number" className="input w-full" required value={woForm.reservation_id} onChange={(e) => setWoForm((f) => ({ ...f, reservation_id: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('pms.fin.amountEgp')}</label>
                <input type="number" min="0.01" step="0.01" className="input w-full" required value={woForm.amount} onChange={(e) => setWoForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <label className="label">{t('pms.fin.ar.reasonCol')}</label>
                <textarea className="input w-full min-h-[80px]" value={woForm.reason} onChange={(e) => setWoForm((f) => ({ ...f, reason: e.target.value }))} placeholder={t('pms.fin.ar.reasonPlaceholder')} />
              </div>
            </form>
          </Modal>
        </div>
      ))}
    </div>
  );
}
