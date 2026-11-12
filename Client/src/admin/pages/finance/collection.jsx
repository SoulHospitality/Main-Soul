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
import DataTable from './DataTable';
import { TimelineLink } from './workspace';
import { BANK_METHODS, CASH_REVIEW_METHODS } from './shared';

export function CashReviewTool() {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [tab, setTab] = useState('pending');
  const [method, setMethod] = useState('');
  const [review, setReview] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-cash-review', tab, method],
    queryFn: () =>
      api
        .get('/financial-system/cash-review', {
          params: { ...(tab === 'reviewed' ? { status: 'reviewed' } : {}), ...(method ? { method } : {}) },
        })
        .then((r) => r.data),
  });

  const saveReview = useMutation({
    mutationFn: ({ id, body }) => api.post(`/financial-system/cash-review/${id}`, body).then((r) => r.data),
    onSuccess: (res) => {
      toast.success(res.corrected ? t('pms.fin.cashReview.corrected') : t('pms.fin.cashReview.confirmed'));
      setReview(null);
      qc.invalidateQueries({ queryKey: ['financial-system-cash-review'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.cashReview.failed')),
  });

  const methodLabel = (m) => t(`pms.fin.cashReview.methods.${m}`) || m;
  const items = data?.items || [];

  /** Confirms several payments as recorded (same amount and method), one after another. */
  async function confirmMany(rows) {
    let ok = 0;
    for (const it of rows) {
      try {
        await api.post(`/financial-system/cash-review/${it.id}`, {});
        ok += 1;
      } catch (e) {
        toast.error(e.response?.data?.error || t('pms.fin.cashReview.failed'));
      }
    }
    if (ok) toast.success(t('pms.fin.cashReview.bulkDone', { count: ok }));
    qc.invalidateQueries({ queryKey: ['financial-system-cash-review'] });
    qc.invalidateQueries({ queryKey: ['financial-system-today'] });
    qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
  }

  function openReview(item) {
    setReview({
      item,
      amount: String(item.amount),
      payment_method: item.payment_method || 'cash',
      bank_account: item.bank_account || '',
      note: '',
    });
  }

  const isUsd = review?.item?.currency === 'USD';
  const corrected =
    review &&
    (Math.abs((parseFloat(review.amount) || 0) - review.item.amount) > 0.004 ||
      review.payment_method !== review.item.payment_method ||
      (BANK_METHODS.includes(review.payment_method) && review.bank_account !== (review.item.bank_account || '')));

  function submitReview() {
    if (!(parseFloat(review.amount) > 0)) {
      toast.error(t('pms.fin.paymentCalendar.amountRequired'));
      return;
    }
    saveReview.mutate({
      id: review.item.id,
      body: {
        amount: review.amount,
        payment_method: review.payment_method,
        bank_account: BANK_METHODS.includes(review.payment_method) ? review.bank_account : null,
        note: review.note.trim() || undefined,
      },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 max-w-3xl">{t('pms.fin.cashReview.description')}</p>

      <div className="grid grid-cols-2 gap-3 max-w-xl">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs text-amber-800">{t('pms.fin.cashReview.waiting')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{data?.pending_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.cashReview.waitingAmount')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(data?.pending_amount || 0)}</p>
        </div>
      </div>

      <div className="inline-flex rounded-xl border border-soul-line bg-white p-1">
        {['pending', 'reviewed'].map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
              tab === id ? 'bg-soul-blue text-white' : 'text-gray-600 hover:bg-slate-50'
            }`}
          >
            {id === 'pending' ? t('pms.fin.cashReview.pendingTab') : t('pms.fin.cashReview.reviewedTab')}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {['', ...CASH_REVIEW_METHODS].map((m) => (
          <button
            key={m || 'all'}
            type="button"
            onClick={() => setMethod(m)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${
              method === m ? 'bg-soul-blue text-white ring-soul-blue' : 'bg-white text-gray-600 ring-soul-line hover:ring-soul-blue/50'
            }`}
          >
            {m ? methodLabel(m) : t('pms.fin.cashReview.allMethods')}
            {m && data?.by_method?.[m] ? <span className="ml-1 opacity-70">{data.by_method[m]}</span> : null}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <DataTable
          rows={items}
          exportName={tab === 'pending' ? 'reservation-collection' : 'reservation-collection-checked'}
          emptyText={tab === 'pending' ? t('pms.fin.cashReview.empty') : t('pms.fin.cashReview.emptyReviewed')}
          initialSort={{ key: 'created_at', dir: 'desc' }}
          bulkActions={
            tab === 'pending'
              ? [{ label: t('pms.fin.cashReview.bulkConfirm'), tone: 'primary', onRun: confirmMany }]
              : []
          }
          columns={[
            {
              key: 'guest_name',
              label: t('pms.fin.cashReview.guest'),
              render: (it) => (
                <span>
                  <TimelineLink id={it.reservation_id}>{it.guest_name || '—'}</TimelineLink>
                  <span className="block text-[11px] text-gray-400">#{it.reservation_id}</span>
                </span>
              ),
            },
            { key: 'unit_name', label: t('pms.fin.cashReview.unit') },
            { key: 'check_in', label: t('pms.fin.cashReview.stay'), nowrap: true, render: (it) => `${formatDate(it.check_in)} → ${formatDate(it.check_out)}` },
            {
              key: 'created_at',
              label: t('pms.fin.cashReview.recordedBy'),
              render: (it) => (
                <span>
                  {it.created_by_name || '—'}
                  <span className="block text-[11px] text-gray-400">{formatDateTime(it.created_at)}</span>
                </span>
              ),
            },
            {
              key: 'payment_method',
              label: t('pms.fin.cashReview.method'),
              value: (it) => methodLabel(it.payment_method),
              render: (it) => (
                <span>
                  {methodLabel(it.payment_method)}
                  {it.bank_account ? ` · ${it.bank_account.toUpperCase()}` : ''}
                  {it.review_original ? (
                    <span className="block text-[11px] text-amber-700">
                      {t('pms.fin.cashReview.wasValue', { amount: currency(it.review_original.amount), method: methodLabel(it.review_original.payment_method) })}
                    </span>
                  ) : null}
                </span>
              ),
            },
            { key: 'amount', label: t('pms.fin.cashReview.amount'), align: 'end', money: true, total: true },
            {
              key: 'action',
              label: '',
              sortable: false,
              noExport: true,
              value: () => '',
              render: (it) =>
                tab === 'pending' ? (
                  <button type="button" className="btn-primary text-xs" onClick={() => openReview(it)}>
                    {t('pms.fin.cashReview.review')}
                  </button>
                ) : (
                  <span className="block max-w-[14rem] text-[11px] text-gray-500">
                    {t('pms.fin.cashReview.reviewedBy', { name: it.reviewed_by_name || '—', date: formatDateTime(it.reviewed_at) })}
                    {it.review_note ? <span className="block truncate italic">{it.review_note}</span> : null}
                  </span>
                ),
            },
          ]}
        />
      )}

      <Modal
        open={Boolean(review)}
        onClose={() => setReview(null)}
        title={t('pms.fin.cashReview.reviewTitle')}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReview(null)}>
              {t('pms.fin.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={saveReview.isPending} onClick={submitReview}>
              {corrected ? t('pms.fin.cashReview.confirmCorrected') : t('pms.fin.cashReview.confirm')}
            </button>
          </>
        }
      >
        {review ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-soul-blue">
                {review.item.guest_name || '—'} · {review.item.unit_name || '—'}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {formatDate(review.item.check_in)} → {formatDate(review.item.check_out)} ·{' '}
                {t('pms.fin.cashReview.reservationTotal', {
                  total: currency(review.item.total_amount),
                  paid: currency(review.item.amount_paid),
                })}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('pms.fin.cashReview.recordedBy')}: {review.item.created_by_name || '—'} ·{' '}
                {formatDateTime(review.item.created_at)}
              </p>
              {review.item.notes ? <p className="text-xs text-gray-600 mt-1">{review.item.notes}</p> : null}
              {review.item.document_path && /^https?:\/\//.test(review.item.document_path) ? (
                <a
                  href={review.item.document_path}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs font-medium text-soul-blue underline"
                >
                  {t('pms.fin.cashReview.proof')}
                </a>
              ) : null}
            </div>

            {isUsd ? (
              <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                {t('pms.fin.cashReview.usdNote', { rate: review.item.exchange_rate || '—' })}
              </p>
            ) : null}

            <div>
              <label className="label">{t('pms.fin.cashReview.amountReceived')}</label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className="input w-full"
                value={review.amount}
                onChange={(e) => setReview((r) => ({ ...r, amount: e.target.value }))}
              />
            </div>

            {!isUsd ? (
              <div>
                <p className="label">{t('pms.fin.cashReview.paymentMethod')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {CASH_REVIEW_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setReview((r) => ({ ...r, payment_method: m }))}
                      className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                        review.payment_method === m
                          ? 'border-[#1e5fbf] bg-[#eef4ff] text-[#1e5fbf]'
                          : 'border-[#e6ebf2] bg-white text-[#5b6b80] hover:bg-[#f6f8fb]'
                      }`}
                    >
                      {methodLabel(m)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!isUsd && BANK_METHODS.includes(review.payment_method) ? (
              <BankAccountPicker
                label={t('pms.fin.cashReview.bankAccount')}
                value={review.bank_account}
                onChange={(v) => setReview((r) => ({ ...r, bank_account: v }))}
              />
            ) : null}

            <div>
              <label className="label">{t('pms.fin.cashReview.note')}</label>
              <textarea
                className="input w-full min-h-[70px]"
                value={review.note}
                onChange={(e) => setReview((r) => ({ ...r, note: e.target.value }))}
                placeholder={t('pms.fin.cashReview.notePlaceholder')}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
