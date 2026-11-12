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
import { ChequeFields, accountLabel, chequeMissing, isBankTreasury, manualAccountOptions, monthlyDueDates, useCustomAccounts } from './shared';

/** Monthly charges are the fixed monthly charges; they post through the payments calendar. */
export function RecurringTool() {
  return <FixedChargesSection />;
}

export function PaymentCalendarTool() {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [selectedDay, setSelectedDay] = useState(today);
  const [editItem, setEditItem] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const emptyForm = (day) => ({
    title: '',
    amount: '',
    due_date: day || today,
    direction: 'out',
    category: 'other',
    status: 'pending',
    notes: '',
    treasury_account_code: '',
    account_code: '',
    repeat: false,
    payment_mode: 'transfer',
    cheque_number: '',
    cheque_photo_url: '',
    repeat_months: '12',
    day_of_month: String(Number(String(day || today).slice(8, 10))),
  });
  const [form, setForm] = useState(() => emptyForm(today));

  const customAccounts = useCustomAccounts();
  const accountOptions = useMemo(() => manualAccountOptions(), [customAccounts]);
  const treasuryOptions = useMemo(() => {
    const codes = treasuryCodes();
    return accountOptions.filter((o) => codes.includes(o.value));
  }, [accountOptions]);

  const range = useMemo(() => {
    const from = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-01`;
    const last = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const to = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    return { from, to };
  }, [cursor]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['financial-system-payment-calendar', range.from, range.to],
    queryFn: () =>
      api
        .get('/financial-system/payment-calendar', { params: { from: range.from, to: range.to } })
        .then((r) => r.data),
  });

  const refreshBooks = () => {
    qc.invalidateQueries({ queryKey: ['financial-system-payment-calendar'] });
    qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
  };

  const saveMutation = useMutation({
    mutationFn: (payload) => {
      if (payload.id) {
        return api.patch(`/financial-system/payment-calendar/${payload.id}`, payload.body);
      }
      return api.post('/financial-system/payment-calendar', payload.body);
    },
    onSuccess: () => {
      toast.success(t('pms.fin.paymentCalendar.saved'));
      setEditItem(null);
      refreshBooks();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.paymentCalendar.saveFailed')),
  });

  const settleMutation = useMutation({
    mutationFn: ({ id, body }) => api.patch(`/financial-system/payment-calendar/${id}`, body),
    onSuccess: (_res, vars) => {
      toast.success(
        vars.body.status === 'paid' ? t('pms.fin.paymentCalendar.markedPaid') : t('pms.fin.paymentCalendar.markedUnpaid')
      );
      setConfirm(null);
      setEditItem(null);
      refreshBooks();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.paymentCalendar.saveFailed')),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, series }) =>
      api.delete(`/financial-system/payment-calendar/${id}`, { params: series ? { scope: 'series' } : undefined }),
    onSuccess: () => {
      toast.success(t('pms.fin.paymentCalendar.deleted'));
      setEditItem(null);
      refreshBooks();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.paymentCalendar.deleteFailed')),
  });

  const items = data?.items || [];
  const summary = data?.summary || {};
  const byDay = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      const key = String(it.due_date).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(it);
    }
    return map;
  }, [items]);

  const days = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startPad = (first.getDay() + 6) % 7; // Monday-first
    const dim = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push(null);
    for (let d = 1; d <= dim; d += 1) {
      const iso = `${cursor.year}-${String(cursor.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push(iso);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const dayItems = byDay.get(selectedDay) || [];
  const seriesDates = useMemo(
    () =>
      form.repeat
        ? monthlyDueDates(
            form.due_date,
            Math.min(Math.max(parseInt(form.repeat_months, 10) || 1, 1), 60),
            Math.min(Math.max(parseInt(form.day_of_month, 10) || 1, 1), 31)
          )
        : [],
    [form.repeat, form.due_date, form.repeat_months, form.day_of_month]
  );

  function openCreate(day) {
    setForm(emptyForm(day || selectedDay || today));
    setEditItem({ mode: 'create' });
  }

  function openEdit(item) {
    if (!item.editable) {
      setEditItem({ mode: 'view', item });
      return;
    }
    setForm({
      ...emptyForm(item.due_date),
      title: item.title || '',
      amount: String(item.amount ?? ''),
      direction: item.direction || 'out',
      category: item.category || 'other',
      status: item.status === 'overdue' ? 'pending' : item.status || 'pending',
      notes: item.notes || '',
      treasury_account_code: item.treasury_account_code || '',
      account_code: item.account_code || '',
      payment_mode: item.payment_mode || 'transfer',
      cheque_number: item.cheque_number || '',
      cheque_photo_url: item.cheque_photo_url || '',
    });
    setEditItem({ mode: 'edit', item });
  }

  function openConfirm(item) {
    setConfirm({
      item,
      amount: String(item.amount ?? ''),
      paid_date: item.paid_date || (item.due_date < today ? item.due_date : today),
      treasury_account_code: item.treasury_account_code || '',
      account_code: item.account_code || '',
      payment_mode: item.payment_mode || 'transfer',
      cheque_number: item.cheque_number || '',
      cheque_photo_url: item.cheque_photo_url || '',
    });
  }

  function submitForm() {
    if (!String(form.title || '').trim()) {
      toast.error(t('pms.fin.paymentCalendar.titleRequired'));
      return;
    }
    if (!form.due_date) {
      toast.error(t('pms.fin.paymentCalendar.dueRequired'));
      return;
    }
    if (!(parseFloat(form.amount) > 0)) {
      toast.error(t('pms.fin.paymentCalendar.amountRequired'));
      return;
    }
    if ((!form.treasury_account_code && form.category !== 'fixed_charge') || !form.account_code) {
      toast.error(t('pms.fin.paymentCalendar.accountsRequired'));
      return;
    }
    const chequeError = chequeMissing(form, form.treasury_account_code);
    if (chequeError) {
      toast.error(t(chequeError));
      return;
    }
    const creating = editItem?.mode === 'create';
    const body = {
      title: form.title.trim(),
      amount: form.amount,
      due_date: form.due_date,
      direction: form.direction,
      category: form.category,
      notes: form.notes,
      treasury_account_code: form.treasury_account_code || null,
      account_code: form.account_code,
      payment_mode: isBankTreasury(form.treasury_account_code) ? form.payment_mode : 'transfer',
      cheque_number: form.cheque_number || null,
      cheque_photo_url: form.cheque_photo_url || null,
    };
    // A paid item keeps its status; saving re-posts its journal with the edited amount and accounts.
    if (form.status !== 'paid') body.status = form.status;
    if (creating && form.repeat) {
      body.repeat_months = Math.min(Math.max(parseInt(form.repeat_months, 10) || 1, 1), 60);
      body.day_of_month = Math.min(Math.max(parseInt(form.day_of_month, 10) || 1, 1), 31);
      body.status = 'pending';
    }
    saveMutation.mutate({ id: creating ? null : editItem.item.source_id, body });
  }

  function submitConfirm() {
    if (!(parseFloat(confirm.amount) > 0)) {
      toast.error(t('pms.fin.paymentCalendar.amountRequired'));
      return;
    }
    if (!confirm.treasury_account_code || !confirm.account_code) {
      toast.error(t('pms.fin.paymentCalendar.accountsRequired'));
      return;
    }
    const chequeError = chequeMissing(confirm, confirm.treasury_account_code);
    if (chequeError) {
      toast.error(t(chequeError));
      return;
    }
    settleMutation.mutate({
      id: confirm.item.source_id,
      body: {
        status: 'paid',
        amount: confirm.amount,
        paid_date: confirm.paid_date,
        treasury_account_code: confirm.treasury_account_code,
        account_code: confirm.account_code,
        payment_mode: isBankTreasury(confirm.treasury_account_code) ? confirm.payment_mode : 'transfer',
        cheque_number: confirm.cheque_number || null,
        cheque_photo_url: confirm.cheque_photo_url || null,
      },
    });
  }

  function statusClass(status) {
    if (status === 'overdue') return 'bg-rose-100 text-rose-800 border-rose-200';
    if (status === 'paid') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (status === 'cancelled') return 'bg-slate-100 text-slate-500 border-slate-200';
    return 'bg-amber-50 text-amber-900 border-amber-200';
  }

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const directionKey = (direction) => (direction === 'in' ? 'In' : 'Out');
  const editing = editItem?.mode === 'edit' ? editItem.item : null;

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-3xl">{t('pms.fin.paymentCalendar.description')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary text-sm" onClick={() => refetch()} disabled={isFetching}>
            {t('pms.fin.paymentCalendar.refresh')}
          </button>
          <button type="button" className="btn-primary text-sm" onClick={() => openCreate(selectedDay)}>
            <Plus className="w-4 h-4" /> {t('pms.fin.paymentCalendar.addManual')}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.paymentCalendar.items')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.total || 0}</p>
          <p className="text-[11px] text-gray-400 mt-1">
            {t('pms.fin.paymentCalendar.sourceSplit', {
              accounting: summary.accounting_count || 0,
              manual: summary.manual_count || 0,
            })}
          </p>
        </div>
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs text-amber-800">{t('pms.fin.paymentCalendar.pending')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.pending || 0}</p>
          <p className="text-xs text-gray-500">{currency(summary.amount_pending)}</p>
        </div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-4">
          <p className="text-xs text-rose-800">{t('pms.fin.paymentCalendar.overdue')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.overdue || 0}</p>
          <p className="text-xs text-gray-500">{currency(summary.amount_overdue)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-xs text-emerald-800">{t('pms.fin.paymentCalendar.paid')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.paid || 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              className="btn-secondary text-xs px-2 py-1"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.year, c.month - 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              ←
            </button>
            <p className="font-semibold text-soul-blue">{monthLabel}</p>
            <button
              type="button"
              className="btn-secondary text-xs px-2 py-1"
              onClick={() =>
                setCursor((c) => {
                  const d = new Date(c.year, c.month + 1, 1);
                  return { year: d.getFullYear(), month: d.getMonth() };
                })
              }
            >
              →
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[11px] text-center text-gray-400 mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((iso, idx) => {
              if (!iso) return <div key={`e-${idx}`} className="min-h-[72px] rounded-lg bg-slate-50/50" />;
              const list = byDay.get(iso) || [];
              const overdueCount = list.filter((x) => x.status === 'overdue').length;
              const selected = iso === selectedDay;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelectedDay(iso)}
                  className={`min-h-[72px] rounded-lg border p-1.5 text-left transition-colors ${
                    selected
                      ? 'border-soul-blue bg-soul-blue-50/50'
                      : overdueCount
                        ? 'border-rose-200 bg-rose-50/40 hover:border-rose-300'
                        : 'border-soul-line bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${isToday ? 'text-soul-blue' : 'text-gray-700'}`}>
                      {Number(iso.slice(8, 10))}
                    </span>
                    {list.length ? (
                      <span className="text-[10px] tabular-nums text-gray-400">{list.length}</span>
                    ) : null}
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 2).map((it) => (
                      <div
                        key={it.id}
                        className={`truncate rounded px-1 py-0.5 text-[10px] border ${statusClass(it.status)}`}
                        title={it.title}
                      >
                        {it.source === 'manual' ? '• ' : ''}
                        {currency(it.amount)}
                      </div>
                    ))}
                    {list.length > 2 ? (
                      <p className="text-[10px] text-gray-400">+{list.length - 2}</p>
                    ) : null}
                  </div>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-gray-400">
            {t('pms.fin.paymentCalendar.legend')}
          </p>
        </div>

        <div className="rounded-2xl border border-soul-line bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wider text-gray-400">{t('pms.fin.paymentCalendar.dayList')}</p>
              <p className="font-semibold text-soul-blue">{formatDate(selectedDay)}</p>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={() => openCreate(selectedDay)}>
              <Plus className="w-3.5 h-3.5" /> {t('pms.fin.paymentCalendar.add')}
            </button>
          </div>
          {!dayItems.length ? (
            <p className="text-sm text-gray-400 py-8 text-center">{t('pms.fin.paymentCalendar.noDayItems')}</p>
          ) : (
            <ul className="space-y-2 max-h-[28rem] overflow-y-auto">
              {dayItems.map((it) => {
                const canConfirm = it.source === 'manual' && (it.status === 'pending' || it.status === 'overdue');
                return (
                  <li key={it.id} className={`rounded-xl border ${statusClass(it.status)}`}>
                    <button
                      type="button"
                      onClick={() => openEdit(it)}
                      className="w-full px-3 py-2.5 text-left rounded-xl hover:bg-white/40"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium truncate">{it.title}</p>
                          <p className="text-[11px] opacity-80 mt-0.5">
                            {it.source === 'manual'
                              ? t('pms.fin.paymentCalendar.manual')
                              : t('pms.fin.paymentCalendar.accounting')}
                            {it.series_count
                              ? ` · ${t('pms.fin.paymentCalendar.seriesBadge', {
                                  index: it.series_index,
                                  count: it.series_count,
                                })}`
                              : ''}
                            {' · '}
                            {t(`pms.fin.paymentCalendar.status.${it.status}`)}
                          </p>
                          {it.treasury_account_code || it.account_code ? (
                            <p className="text-[11px] opacity-80 mt-0.5 truncate">
                              {it.direction === 'in'
                                ? `${accountLabel(it.account_code)} → ${accountLabel(it.treasury_account_code)}`
                                : `${accountLabel(it.treasury_account_code)} → ${accountLabel(it.account_code)}`}
                            </p>
                          ) : null}
                          {it.payment_mode === 'cheque' && it.cheque_number ? (
                            <p className="text-[11px] mt-0.5">{t('pms.fin.cheque.badge', { number: it.cheque_number })}</p>
                          ) : null}
                          {it.status === 'paid' && it.paid_date ? (
                            <p className="text-[11px] mt-0.5">
                              {t('pms.fin.paymentCalendar.paidSummary', {
                                amount: currency(it.amount),
                                date: formatDate(it.paid_date),
                              })}
                            </p>
                          ) : null}
                        </div>
                        <p className="font-semibold tabular-nums shrink-0">{currency(it.amount)}</p>
                      </div>
                    </button>
                    {canConfirm ? (
                      <div className="px-3 pb-2.5">
                        <button
                          type="button"
                          className="btn-primary text-xs w-full justify-center"
                          onClick={() => openConfirm(it)}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {it.direction === 'in'
                            ? t('pms.fin.paymentCalendar.confirmReceived')
                            : t('pms.fin.paymentCalendar.confirmPaid')}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <Modal
        open={Boolean(editItem)}
        onClose={() => setEditItem(null)}
        title={
          editItem?.mode === 'create'
            ? t('pms.fin.paymentCalendar.addManual')
            : editItem?.mode === 'edit'
              ? t('pms.fin.paymentCalendar.editManual')
              : t('pms.fin.paymentCalendar.details')
        }
        size="md"
        footer={
          editItem?.mode === 'view' ? (
            <button type="button" className="btn-secondary" onClick={() => setEditItem(null)}>
              {t('pms.fin.paymentCalendar.close')}
            </button>
          ) : (
            <>
              {editing ? (
                <div className="mr-auto flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary text-rose-700"
                    disabled={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate({ id: editing.source_id })}
                  >
                    {t('pms.fin.paymentCalendar.delete')}
                  </button>
                  {editing.series_id ? (
                    <button
                      type="button"
                      className="btn-secondary text-rose-700"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate({ id: editing.source_id, series: true })}
                    >
                      {t('pms.fin.paymentCalendar.deleteSeries')}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <button type="button" className="btn-secondary" onClick={() => setEditItem(null)}>
                {t('pms.fin.paymentCalendar.cancel')}
              </button>
              <button type="button" className="btn-primary" disabled={saveMutation.isPending} onClick={submitForm}>
                {saveMutation.isPending ? t('pms.fin.paymentCalendar.saving') : t('pms.fin.paymentCalendar.save')}
              </button>
            </>
          )
        }
      >
        {editItem?.mode === 'view' && editItem.item ? (
          <div className="space-y-3 text-sm">
            <p className="font-semibold text-soul-blue">{editItem.item.title}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.amount')}</p>
                <p className="tabular-nums font-medium">{currency(editItem.item.amount)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.dueDate')}</p>
                <p>{formatDate(editItem.item.due_date)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.statusLabel')}</p>
                <p>{t(`pms.fin.paymentCalendar.status.${editItem.item.status}`)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.paymentCalendar.source')}</p>
                <p>{t('pms.fin.paymentCalendar.accounting')}</p>
              </div>
            </div>
            {editItem.item.related_ref ? (
              <p className="text-xs text-gray-500">{editItem.item.related_ref}</p>
            ) : null}
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              {t('pms.fin.paymentCalendar.accountingReadOnly')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {editing && editing.status === 'paid' ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                <p className="font-medium">
                  {t('pms.fin.paymentCalendar.paidSummary', {
                    amount: currency(editing.amount),
                    date: formatDate(editing.paid_date || editing.due_date),
                  })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => openConfirm(editing)}>
                    {t('pms.fin.paymentCalendar.changePaid')}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary text-xs text-rose-700"
                    disabled={settleMutation.isPending}
                    onClick={() => settleMutation.mutate({ id: editing.source_id, body: { status: 'pending' } })}
                  >
                    {t('pms.fin.paymentCalendar.markUnpaid')}
                  </button>
                </div>
              </div>
            ) : null}
            <div>
              <label className="label">{t('pms.fin.paymentCalendar.title')} *</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.direction')}</label>
                <select
                  className="input"
                  value={form.direction}
                  onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}
                >
                  <option value="out">{t('pms.fin.paymentCalendar.directionOut')}</option>
                  <option value="in">{t('pms.fin.paymentCalendar.directionIn')}</option>
                </select>
              </div>
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.amount')} *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="label">{t(`pms.fin.paymentCalendar.treasury${directionKey(form.direction)}`)} *</label>
              <SearchableSelect
                className="w-full"
                value={form.treasury_account_code}
                onChange={(v) => setForm((f) => ({ ...f, treasury_account_code: v }))}
                placeholder={t('pms.fin.paymentCalendar.chooseTreasury')}
                options={treasuryOptions}
              />
              {form.category === 'fixed_charge' && !form.treasury_account_code ? (
                <p className="text-[11px] text-gray-500 mt-1">{t('pms.fin.fixed.treasuryLater')}</p>
              ) : null}
            </div>
            {isBankTreasury(form.treasury_account_code) ? <ChequeFields value={form} onChange={setForm} /> : null}
            <div>
              <label className="label">{t(`pms.fin.paymentCalendar.counter${directionKey(form.direction)}`)} *</label>
              <SearchableSelect
                className="w-full"
                value={form.account_code}
                onChange={(v) => setForm((f) => ({ ...f, account_code: v }))}
                placeholder={t('pms.fin.paymentCalendar.chooseAccount')}
                options={accountOptions.filter((o) => o.value !== form.treasury_account_code)}
              />
            </div>

            {editItem?.mode === 'create' ? (
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={form.repeat}
                  onChange={(e) => setForm((f) => ({ ...f, repeat: e.target.checked }))}
                />
                {t('pms.fin.paymentCalendar.repeatMonthly')}
              </label>
            ) : null}

            {form.repeat && editItem?.mode === 'create' ? (
              <div className="rounded-xl border border-soul-line bg-slate-50/60 p-3 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="label">{t('pms.fin.paymentCalendar.firstMonth')}</label>
                    <input
                      type="month"
                      className="input"
                      value={String(form.due_date).slice(0, 7)}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, due_date: e.target.value ? `${e.target.value}-01` : f.due_date }))
                      }
                    />
                  </div>
                  <div>
                    <label className="label">{t('pms.fin.paymentCalendar.dayOfMonth')}</label>
                    <input
                      type="number"
                      min="1"
                      max="31"
                      className="input"
                      value={form.day_of_month}
                      onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label">{t('pms.fin.paymentCalendar.months')}</label>
                    <input
                      type="number"
                      min="1"
                      max="60"
                      className="input"
                      value={form.repeat_months}
                      onChange={(e) => setForm((f) => ({ ...f, repeat_months: e.target.value }))}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">{t('pms.fin.paymentCalendar.repeatHint')}</p>
                {seriesDates.length ? (
                  <p className="text-xs font-medium text-soul-blue">
                    {t('pms.fin.paymentCalendar.seriesPreview', {
                      count: seriesDates.length,
                      amount: currency(parseFloat(form.amount) || 0),
                      first: formatDate(seriesDates[0]),
                      last: formatDate(seriesDates[seriesDates.length - 1]),
                    })}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.paymentCalendar.dueDate')} *</label>
                  <input
                    type="date"
                    className="input"
                    value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  />
                </div>
                {form.status !== 'paid' ? (
                  <div>
                    <label className="label">{t('pms.fin.paymentCalendar.statusLabel')}</label>
                    <select
                      className="input"
                      value={form.status}
                      onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                    >
                      <option value="pending">{t('pms.fin.paymentCalendar.status.pending')}</option>
                      <option value="cancelled">{t('pms.fin.paymentCalendar.status.cancelled')}</option>
                    </select>
                  </div>
                ) : null}
              </div>
            )}

            <div>
              <label className="label">{t('pms.fin.paymentCalendar.notes')}</label>
              <textarea
                className="input min-h-[80px]"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        title={t('pms.fin.paymentCalendar.confirmTitle')}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setConfirm(null)}>
              {t('pms.fin.paymentCalendar.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={settleMutation.isPending} onClick={submitConfirm}>
              {settleMutation.isPending
                ? t('pms.fin.paymentCalendar.saving')
                : confirm?.item?.direction === 'in'
                  ? t('pms.fin.paymentCalendar.confirmReceived')
                  : t('pms.fin.paymentCalendar.confirmPaid')}
            </button>
          </>
        }
      >
        {confirm ? (
          <div className="space-y-3">
            <div>
              <p className="font-semibold text-soul-blue">{confirm.item.title}</p>
              <p className="text-xs text-gray-500">
                {formatDate(confirm.item.due_date)} · {t('pms.fin.paymentCalendar.plannedAmount')}{' '}
                {currency(confirm.item.amount)}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.paidAmount')} *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input"
                  value={confirm.amount}
                  onChange={(e) => setConfirm((c) => ({ ...c, amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.paymentCalendar.paidDate')} *</label>
                <input
                  type="date"
                  min={FINANCIAL_EPOCH}
                  className="input"
                  value={confirm.paid_date}
                  onChange={(e) => setConfirm((c) => ({ ...c, paid_date: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500 -mt-1">{t('pms.fin.paymentCalendar.paidAmountHint')}</p>
            <div>
              <label className="label">
                {t(`pms.fin.paymentCalendar.treasury${directionKey(confirm.item.direction)}`)} *
              </label>
              <SearchableSelect
                className="w-full"
                value={confirm.treasury_account_code}
                onChange={(v) => setConfirm((c) => ({ ...c, treasury_account_code: v }))}
                placeholder={t('pms.fin.paymentCalendar.chooseTreasury')}
                options={treasuryOptions}
              />
            </div>
            {isBankTreasury(confirm.treasury_account_code) ? (
              <ChequeFields value={confirm} onChange={setConfirm} />
            ) : null}
            <div>
              <label className="label">
                {t(`pms.fin.paymentCalendar.counter${directionKey(confirm.item.direction)}`)} *
              </label>
              <SearchableSelect
                className="w-full"
                value={confirm.account_code}
                onChange={(v) => setConfirm((c) => ({ ...c, account_code: v }))}
                placeholder={t('pms.fin.paymentCalendar.chooseAccount')}
                options={accountOptions.filter((o) => o.value !== confirm.treasury_account_code)}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export function FixedChargesSection() {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const empty = { title: '', amount: '', day_of_month: '1', repeat_months: '12', start_month: thisMonth };
  const [form, setForm] = useState(empty);
  const [open, setOpen] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ['financial-system-fixed-charges'],
    queryFn: () => api.get('/financial-system/fixed-charges').then((r) => r.data),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['financial-system-fixed-charges'] });
    qc.invalidateQueries({ queryKey: ['financial-system-payment-calendar'] });
  };

  const add = useMutation({
    mutationFn: (body) => api.post('/financial-system/payment-calendar', body),
    onSuccess: () => {
      toast.success(t('pms.fin.fixed.added'));
      setForm(empty);
      setOpen(false);
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const remove = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/payment-calendar/${id}`, { params: { scope: 'series' } }),
    onSuccess: () => {
      toast.success(t('pms.fin.fixed.removed'));
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  function submit() {
    const months = Math.min(Math.max(parseInt(form.repeat_months, 10) || 1, 1), 60);
    const day = Math.min(Math.max(parseInt(form.day_of_month, 10) || 1, 1), 31);
    if (!form.title.trim()) return toast.error(t('pms.fin.paymentCalendar.titleRequired'));
    if (!(parseFloat(form.amount) > 0)) return toast.error(t('pms.fin.paymentCalendar.amountRequired'));
    add.mutate({
      title: form.title.trim(),
      amount: form.amount,
      direction: 'out',
      category: 'fixed_charge',
      account_code: '613000',
      due_date: `${form.start_month}-01`,
      repeat_months: months,
      day_of_month: day,
    });
  }

  const preview = monthlyDueDates(
    `${form.start_month}-01`,
    Math.min(Math.max(parseInt(form.repeat_months, 10) || 1, 1), 60),
    Math.min(Math.max(parseInt(form.day_of_month, 10) || 1, 1), 31)
  );

  return (
    <section className="rounded-2xl border border-soul-line bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-soul-blue">{t('pms.fin.fixed.title')}</h3>
          <p className="text-sm text-gray-500 max-w-2xl">{t('pms.fin.fixed.description')}</p>
        </div>
        <button type="button" className="btn-primary text-sm" onClick={() => setOpen((o) => !o)}>
          <Plus className="w-4 h-4" /> {t('pms.fin.fixed.add')}
        </button>
      </div>

      {open ? (
        <div className="rounded-xl border border-soul-line bg-slate-50/60 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2">
              <label className="label">{t('pms.fin.fixed.name')} *</label>
              <input
                className="input w-full"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.fixed.amount')} *</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="input w-full"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.fixed.day')}</label>
              <input
                type="number"
                min="1"
                max="31"
                className="input w-full"
                value={form.day_of_month}
                onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.fixed.months')}</label>
              <input
                type="number"
                min="1"
                max="60"
                className="input w-full"
                value={form.repeat_months}
                onChange={(e) => setForm((f) => ({ ...f, repeat_months: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.fixed.startMonth')}</label>
              <input
                type="month"
                className="input w-full"
                value={form.start_month}
                onChange={(e) => setForm((f) => ({ ...f, start_month: e.target.value || thisMonth }))}
              />
            </div>
          </div>
          {preview.length ? (
            <p className="text-xs text-soul-blue">
              {t('pms.fin.paymentCalendar.seriesPreview', {
                count: preview.length,
                amount: currency(parseFloat(form.amount) || 0),
                first: formatDate(preview[0]),
                last: formatDate(preview[preview.length - 1]),
              })}
            </p>
          ) : null}
          <p className="text-[11px] text-gray-500">{t('pms.fin.fixed.hint')}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              {t('pms.fin.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={add.isPending} onClick={submit}>
              {t('pms.fin.save')}
            </button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <LoadingSpinner />
      ) : !data.length ? (
        <p className="text-sm text-gray-400 py-4 text-center">{t('pms.fin.fixed.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <SmartTable name="calendar-1"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.fixed.name')}</th>
                <th className="text-right">{t('pms.fin.fixed.amount')}</th>
                <th>{t('pms.fin.fixed.day')}</th>
                <th>{t('pms.fin.fixed.period')}</th>
                <th>{t('pms.fin.fixed.progress')}</th>
                <th>{t('pms.fin.fixed.next')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.key}>
                  <td className="font-medium text-soul-blue">{row.title}</td>
                  <td className="text-right tabular-nums">{currency(row.amount)}</td>
                  <td>{row.day_of_month}</td>
                  <td className="whitespace-nowrap">
                    {formatDate(row.first_due)} → {formatDate(row.last_due)}
                  </td>
                  <td>{t('pms.fin.fixed.paidOf', { paid: row.paid, months: row.months })}</td>
                  <td>{row.next_due ? formatDate(row.next_due) : '—'}</td>
                  <td className="text-right">
                    {row.next_id ? (
                      <button
                        type="button"
                        className="p-1.5 text-gray-400 hover:text-rose-600"
                        title={t('pms.fin.fixed.stop')}
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(row.next_id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></SmartTable>
        </div>
      )}
    </section>
  );
}
