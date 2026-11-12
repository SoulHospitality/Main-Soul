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

export const GROUP_META = {
  assets: {
    label: ACCOUNT_GROUPS.assets,
    icon: Landmark,
    tint: 'bg-sky-50 text-sky-800',
    tile: 'bg-sky-600',
    hint: 'What Soul holds',
  },
  liabilities: {
    label: ACCOUNT_GROUPS.liabilities,
    icon: Shield,
    tint: 'bg-amber-50 text-amber-900',
    tile: 'bg-amber-500',
    hint: 'What Soul owes',
  },
  equity: {
    label: ACCOUNT_GROUPS.equity,
    icon: PiggyBank,
    tint: 'bg-slate-100 text-slate-800',
    tile: 'bg-slate-700',
    hint: 'Capital and earnings',
  },
  revenue: {
    label: ACCOUNT_GROUPS.revenue,
    icon: TrendingUp,
    tint: 'bg-emerald-50 text-emerald-900',
    tile: 'bg-emerald-600',
    hint: 'Reservation totals plus custom revenue',
  },
  expenses: {
    label: ACCOUNT_GROUPS.expenses,
    icon: Receipt,
    tint: 'bg-orange-50 text-orange-900',
    tile: 'bg-orange-500',
    hint: 'Direct costs and company running costs',
  },
};

export function manualAccountOptions() {
  return CHART_OF_ACCOUNTS.filter((a) => !a.virtual).map((a) => ({
    value: a.code,
    label: `${a.code} — ${a.name}`,
    group: ACCOUNT_GROUPS[a.group] || a.group,
  }));
}

export function useCustomAccounts() {
  const { data } = useQuery({
    queryKey: ['financial-system-custom-accounts'],
    queryFn: () =>
      api.get('/financial-system/custom-accounts').then((r) => {
        setCustomAccounts(r.data || []);
        return r.data || [];
      }),
    staleTime: 60_000,
  });
  return data || [];
}

export const ACCOUNT_ICONS = {
  '101000': Landmark,
  '102000': Landmark,
  '103000': Banknote,
  '104000': Banknote,
  '105000': CircleDollarSign,
  '106000': CreditCard,
  '107000': Scale,
  '202000': Users,
  '205000': Scale,
  '400000': TrendingUp,
  '401000': TrendingUp,
  '506000': Users,
  '508000': UtensilsCrossed,
  '613000': Home,
  '608000': Zap,
  '609000': Users,
};

export function IconFor({ code, group, className = 'w-5 h-5' }) {
  const Comp = ACCOUNT_ICONS[code] || ACCOUNT_ICONS[getAccount(code)?.parent_code] || GROUP_META[group]?.icon || BookOpen;
  return <Comp className={className} />;
}

export function cairoYearMonth() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }).slice(0, 7);
}

export function clampYearMonth(ym) {
  const epochYm = FINANCIAL_EPOCH.slice(0, 7);
  const raw = String(ym || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) return clampYearMonth(cairoYearMonth());
  return raw < epochYm ? epochYm : raw;
}

export function monthBounds(ym) {
  const safe = clampYearMonth(ym);
  const [y, m] = safe.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
  return { from, to };
}

export function clampDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return FINANCIAL_EPOCH;
  return raw < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : raw;
}

export function presetRange(id) {
  const ym = cairoYearMonth();
  const [y, m] = ym.split('-').map(Number);
  if (id === 'last_month') {
    return monthBounds(m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`);
  }
  if (id === 'this_quarter') {
    const qStart = Math.floor((m - 1) / 3) * 3 + 1;
    const end = monthBounds(`${y}-${String(qStart + 2).padStart(2, '0')}`).to;
    return { from: clampDate(`${y}-${String(qStart).padStart(2, '0')}-01`), to: end };
  }
  if (id === 'this_year') return { from: clampDate(`${y}-01-01`), to: `${y}-12-31` };
  return monthBounds(ym);
}

export function DateFilters({ fromDate, toDate, basis, onChange }) {
  const { t } = useFinLocale();
  const presets = [
    ['this_month', t('pms.fin.presetThisMonth')],
    ['last_month', t('pms.fin.presetLastMonth')],
    ['this_quarter', t('pms.fin.presetThisQuarter')],
    ['this_year', t('pms.fin.presetThisYear')],
  ];

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('pms.fin.countBy')}</label>
        <select
          className="input w-36 text-sm py-1.5"
          value={basis}
          onChange={(e) => onChange({ basis: e.target.value })}
        >
          <option value="stay">{t('pms.fin.basisStay')}</option>
          <option value="created">{t('pms.fin.basisCreated')}</option>
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('pms.fin.dateFrom')}</label>
        <input
          type="date"
          className="input w-40 text-sm py-1.5"
          min={FINANCIAL_EPOCH}
          value={fromDate}
          onChange={(e) => onChange({ from: clampDate(e.target.value) })}
        />
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">{t('pms.fin.dateTo')}</label>
        <input
          type="date"
          className="input w-40 text-sm py-1.5"
          min={fromDate || FINANCIAL_EPOCH}
          value={toDate}
          onChange={(e) => onChange({ to: e.target.value || '' })}
        />
      </div>
      <div className="flex gap-1">
        {presets.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="btn-secondary text-xs px-2.5 py-1.5"
            onClick={() => onChange(presetRange(id))}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ExportPeriodModal({ open, defaultFrom, defaultTo, onClose, onConfirm, exporting }) {
  const { t } = useFinLocale();
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card w-full max-w-md space-y-4 p-5 shadow-xl">
        <div>
          <h2 className="text-lg font-semibold text-soul-blue">{t('pms.fin.exportPeriodTitle')}</h2>
          <p className="text-sm text-gray-500 mt-1">{t('pms.fin.exportPeriodHint')}</p>
        </div>
        <div className="space-y-3">
          <div>
            <label className="label text-xs">{t('pms.fin.dateFrom')}</label>
            <input
              type="date"
              className="input text-sm"
              min={FINANCIAL_EPOCH}
              value={fromDate}
              onChange={(e) => setFromDate(clampDate(e.target.value))}
            />
          </div>
          <div>
            <label className="label text-xs">{t('pms.fin.dateTo')}</label>
            <input
              type="date"
              className="input text-sm"
              min={fromDate || FINANCIAL_EPOCH}
              value={toDate}
              onChange={(e) => setToDate(e.target.value || fromDate)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary text-sm" onClick={onClose} disabled={exporting}>
            {t('pms.fin.cancel')}
          </button>
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={exporting}
            onClick={() => {
              const from = clampDate(fromDate);
              const to = toDate && toDate >= from ? toDate : from;
              onConfirm(from, to);
            }}
          >
            {exporting ? t('pms.fin.exporting') : t('pms.fin.exportExcel')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function useFinanceNav() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') || 'home';
  const group = searchParams.get('group') || '';
  const code = searchParams.get('code') || '';
  const txn = searchParams.get('txn') || '';
  const tabAlias = {
    assets: 'assets',
    owners: 'owners',
    settlements: 'owners',
    statement: 'owners',
    tax: 'tax',
    manual: 'manual',
    expenses: 'manual',
    petty: 'petty',
    'petty-cash': 'petty',
    reports: 'reports',
    aging: 'aging',
    insurance: 'insurance',
    'cash-review': 'cash-review',
    'cancel-requests': 'cancel-requests',
    cancellations: 'cancel-requests',
    'expense-forecast': 'expense-forecast',
    forecast: 'expense-forecast',
    'checkin-audit': 'checkin-audit',
    checkins: 'checkin-audit',
    'check-in-audit': 'checkin-audit',
    'payment-calendar': 'payment-calendar',
    calendar: 'payment-calendar',
    'payments-calendar': 'payment-calendar',
    close: 'close',
    gateway: 'gateway',
    bank: 'bank',
    trust: 'trust',
    vendors: 'vendors',
    ar: 'ar',
  };
  const tool = searchParams.get('tool') || tabAlias[searchParams.get('tab')] || '';

  function go(next) {
    const nextParams = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([k, v]) => {
      if (v == null || v === '') nextParams.delete(k);
      else nextParams.set(k, String(v));
    });
    setSearchParams(nextParams, { replace: true });
  }

  return { view, group, code, txn, tool, go, searchParams, setSearchParams };
}

export function rangeParams(fromDate, toDate, basis) {
  return { from_date: fromDate || undefined, to_date: toDate || undefined, basis: basis || undefined };
}

/** Counts that need finance's attention: cash payments waiting for review and overdue calendar payments. */
export function useFinanceAlerts() {
  const today = new Date().toISOString().slice(0, 10);
  const cash = useQuery({
    queryKey: ['financial-system-cash-review', 'pending'],
    queryFn: () => api.get('/financial-system/cash-review').then((r) => r.data),
    staleTime: 30_000,
  });
  const calendar = useQuery({
    queryKey: ['financial-system-payment-calendar', 'overdue', today],
    queryFn: () =>
      api
        .get('/financial-system/payment-calendar', { params: { from: FINANCIAL_EPOCH, to: today } })
        .then((r) => r.data),
    staleTime: 60_000,
  });
  return {
    cashReview: cash.data?.pending_count || 0,
    cashReviewAmount: cash.data?.pending_amount || 0,
    overdue: calendar.data?.summary?.overdue || 0,
  };
}

/** Red circle with a count; hidden at zero. */
export function CountBadge({ count, label, className = '' }) {
  if (!count) return null;
  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-xs font-bold leading-none text-white tabular-nums shadow-sm ${className}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

export function useInvalidateAccounts() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['financial-system-custom-accounts'] });
    qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    qc.invalidateQueries({ queryKey: ['financial-system-account'] });
  };
}

export function AccountLines({ rows, amountKey = 'balance' }) {
  const { t } = useFinLocale();
  if (!rows?.length) return <p className="text-sm text-gray-400 py-6 text-center">{t('pms.fin.reports.noBalances')}</p>;
  return (
    <table className="table text-sm">
      <thead>
        <tr>
          <th>{t('pms.fin.reports.thAccount')}</th>
          <th className="text-right">{t('pms.fin.amount')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((a) => (
          <tr key={a.code}>
            <td>
              <span className="font-mono text-[11px] text-gray-400 mr-2">{a.code}</span>
              {a.name}
            </td>
            <td className="text-right tabular-nums">{currency(a[amountKey] ?? a.balance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Same day each month, moved to the month's last day when the month is shorter (matches the server). */
export function monthlyDueDates(startIso, months, day) {
  if (!startIso) return [];
  const [y, m] = startIso.split('-').map(Number);
  const out = [];
  for (let i = 0; i < months; i += 1) {
    const first = new Date(Date.UTC(y, m - 1 + i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    const mm = String(first.getUTCMonth() + 1).padStart(2, '0');
    out.push(`${first.getUTCFullYear()}-${mm}-${String(Math.min(day, last)).padStart(2, '0')}`);
  }
  return out;
}

export function accountLabel(code) {
  if (!code) return '';
  const acct = getAccount(code);
  return acct ? `${code} ${acct.name}` : code;
}

export const CASH_REVIEW_METHODS = ['cash', 'instapay', 'bank_transfer', 'credit_card', 'paymob_card', 'online', 'other'];

export const BANK_METHODS = ['instapay', 'bank_transfer'];

/** Bank treasury (ADIB / CIB) or one of its sub-accounts. */
export function isBankTreasury(code) {
  if (!code) return false;
  const root = getAccount(code)?.parent_code || code;
  return root === '101000' || root === '102000';
}

export function useTreasuryOptions() {
  const customAccounts = useCustomAccounts();
  return useMemo(() => {
    const codes = treasuryCodes();
    return manualAccountOptions().filter((o) => codes.includes(o.value));
  }, [customAccounts]);
}

/** Transfer or cheque for a bank treasury; a cheque needs its number and a photo. */
export function ChequeFields({ value, onChange }) {
  const { t } = useFinLocale();
  const [uploading, setUploading] = useState(false);
  const mode = value.payment_mode === 'cheque' ? 'cheque' : 'transfer';

  async function uploadPhoto(file) {
    if (!file) return;
    setUploading(true);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.post('/financial-system/uploads', body);
      onChange({ ...value, cheque_photo_url: data.url });
    } catch (e) {
      toast.error(e.response?.data?.error || t('pms.fin.cheque.uploadFailed'));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="rounded-xl border border-soul-line bg-slate-50/60 p-3 space-y-3">
      <div>
        <p className="label">{t('pms.fin.cheque.paidBy')}</p>
        <div className="grid grid-cols-2 gap-2">
          {['transfer', 'cheque'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange({ ...value, payment_mode: m })}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                mode === m
                  ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                  : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
              }`}
            >
              {t(`pms.fin.cheque.${m}`)}
            </button>
          ))}
        </div>
      </div>
      {mode === 'cheque' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">{t('pms.fin.cheque.number')} *</label>
            <input
              className="input"
              value={value.cheque_number || ''}
              onChange={(e) => onChange({ ...value, cheque_number: e.target.value })}
            />
          </div>
          <div>
            <label className="label">{t('pms.fin.cheque.photo')} *</label>
            {value.cheque_photo_url ? (
              <div className="flex items-center gap-2 text-sm">
                <a href={value.cheque_photo_url} target="_blank" rel="noreferrer" className="text-soul-blue underline">
                  {t('pms.fin.cheque.viewPhoto')}
                </a>
                <button
                  type="button"
                  className="text-xs text-rose-700"
                  onClick={() => onChange({ ...value, cheque_photo_url: '' })}
                >
                  {t('pms.fin.cheque.replace')}
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept="image/*,application/pdf"
                className="input py-1.5 text-xs"
                disabled={uploading}
                onChange={(e) => uploadPhoto(e.target.files?.[0])}
              />
            )}
            {uploading ? <p className="text-[11px] text-gray-500 mt-1">{t('pms.fin.cheque.uploading')}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Returns an error message key when a cheque is missing its number or photo. */
export function chequeMissing(value, treasury) {
  if (!isBankTreasury(treasury) || value.payment_mode !== 'cheque') return null;
  if (!String(value.cheque_number || '').trim()) return 'pms.fin.cheque.numberRequired';
  if (!value.cheque_photo_url) return 'pms.fin.cheque.photoRequired';
  return null;
}

export const CANCEL_CHOICES = {
  full_refund: 'pms.fin.cancelRequests.choiceFull',
  partial_refund: 'pms.fin.cancelRequests.choicePartial',
  forfeit: 'pms.fin.cancelRequests.choiceForfeit',
};

/** Developer picker for entries on the Developer expense account, with an inline "add developer". */
export function DeveloperPicker({ value, onChange }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const { data = [] } = useQuery({
    queryKey: ['financial-system-developers'],
    queryFn: () => api.get('/financial-system/developers').then((r) => r.data),
  });
  const create = useMutation({
    mutationFn: (devName) => api.post('/financial-system/developers', { name: devName }).then((r) => r.data),
    onSuccess: (dev) => {
      qc.invalidateQueries({ queryKey: ['financial-system-developers'] });
      onChange(String(dev.id));
      setAdding(false);
      setName('');
    },
    onError: (e) => {
      const existing = e.response?.data?.developer;
      if (existing) {
        onChange(String(existing.id));
        setAdding(false);
        setName('');
        return;
      }
      toast.error(e.response?.data?.error || t('pms.fin.failed'));
    },
  });

  return (
    <div>
      <label className="label">{t('pms.fin.developers.which')} *</label>
      {adding ? (
        <div className="flex gap-2">
          <input
            className="input flex-1"
            value={name}
            autoFocus
            placeholder={t('pms.fin.developers.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            className="btn-primary text-sm"
            disabled={create.isPending || !name.trim()}
            onClick={() => create.mutate(name.trim())}
          >
            {t('pms.fin.save')}
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={() => setAdding(false)}>
            {t('pms.fin.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select className="input flex-1" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">{t('pms.fin.developers.choose')}</option>
            {data.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary text-sm whitespace-nowrap" onClick={() => setAdding(true)}>
            <Plus className="w-3.5 h-3.5" /> {t('pms.fin.developers.add')}
          </button>
        </div>
      )}
    </div>
  );
}

export function isDeveloperAccount(code) {
  return code === '619000' || getAccount(code)?.parent_code === '619000';
}

export const ACTION_TYPE_KEYS = [
  { value: 'reminder_sent', labelKey: 'reminderSent' },
  { value: 'phone_call', labelKey: 'phoneCall' },
  { value: 'final_notice', labelKey: 'finalNotice' },
  { value: 'write_off_proposed', labelKey: 'writeOffProposed' },
  { value: 'dispute', labelKey: 'dispute' },
  { value: 'payment_plan', labelKey: 'paymentPlan' },
];
