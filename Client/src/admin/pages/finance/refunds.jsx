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
import { TimelineLink } from './workspace';
import { CANCEL_CHOICES, accountLabel, useTreasuryOptions } from './shared';

export function CancelRequestsCard({ onOpen }) {
  const { t } = useFinLocale();
  const { data } = useQuery({
    queryKey: ['financial-system-cancel-requests', 'pending'],
    queryFn: () => api.get('/financial-system/cancel-requests').then((r) => r.data),
    staleTime: 30_000,
  });
  const count = data?.pending_count || 0;
  if (!count) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-rose-200 bg-rose-50/70 p-5 text-left hover:border-rose-300"
    >
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center">
          <Receipt className="w-6 h-6" />
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wider text-rose-800">{t('pms.fin.home.cancelRequestsTitle')}</p>
          <p className="font-semibold text-soul-blue">{t('pms.fin.home.cancelRequestsSubtitle')}</p>
          <p className="text-xs text-gray-500 mt-0.5">{t('pms.fin.home.cancelRequestsHint', { count })}</p>
        </div>
        <p className="text-2xl font-bold tabular-nums text-rose-900">{count}</p>
      </div>
    </button>
  );
}

export function CancelRequestsTool() {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const treasuryOptions = useTreasuryOptions();
  const [tab, setTab] = useState('pending');
  const [decide, setDecide] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-cancel-requests', tab],
    queryFn: () =>
      api
        .get('/financial-system/cancel-requests', { params: tab === 'approved' ? { status: 'approved' } : {} })
        .then((r) => r.data),
  });

  const approve = useMutation({
    mutationFn: ({ id, body }) => api.post(`/financial-system/cancel-requests/${id}/approve`, body),
    onSuccess: () => {
      toast.success(t('pms.fin.cancelRequests.approved'));
      setDecide(null);
      qc.invalidateQueries({ queryKey: ['financial-system-cancel-requests'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const items = data?.items || [];
  const refundValue = parseFloat(decide?.refund_amount) || 0;

  function submit() {
    if (refundValue < 0) return toast.error(t('pms.fin.cancelRequests.amountInvalid'));
    if (refundValue - (decide.item.still_held || 0) > 0.009) return toast.error(t('pms.fin.cancelRequests.tooMuch'));
    if (refundValue > 0 && !decide.treasury_account_code) return toast.error(t('pms.fin.cancelRequests.chooseTreasury'));
    approve.mutate({
      id: decide.item.id,
      body: {
        refund_amount: refundValue,
        treasury_account_code: refundValue > 0 ? decide.treasury_account_code : undefined,
        refund_date: decide.refund_date,
        note: decide.note.trim() || undefined,
      },
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 max-w-3xl">{t('pms.fin.cancelRequests.description')}</p>
      <div className="inline-flex rounded-xl border border-soul-line bg-white p-1">
        {['pending', 'approved'].map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium ${
              tab === id ? 'bg-soul-blue text-white' : 'text-gray-600 hover:bg-slate-50'
            }`}
          >
            {t(`pms.fin.cancelRequests.${id}Tab`)}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !items.length ? (
        <p className="rounded-2xl border border-soul-line bg-white py-10 text-center text-sm text-gray-400">
          {t(`pms.fin.cancelRequests.${tab === 'pending' ? 'empty' : 'emptyApproved'}`)}
        </p>
      ) : (
        <div className="rounded-2xl border border-soul-line bg-white overflow-x-auto">
          <SmartTable name="refunds-1"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.cashReview.guest')}</th>
                <th>{t('pms.fin.cashReview.stay')}</th>
                <th>{t('pms.fin.cancelRequests.cancelledBy')}</th>
                <th>{t('pms.fin.cancelRequests.requested')}</th>
                <th className="text-right">{t('pms.fin.cancelRequests.collected')}</th>
                <th className="text-right">
                  {tab === 'pending' ? t('pms.fin.cancelRequests.requestedRefund') : t('pms.fin.cancelRequests.refunded')}
                </th>
                <th>Approvals</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <p className="font-medium text-soul-blue"><TimelineLink id={it.reservation_id}>{it.guest_name || '—'}</TimelineLink></p>
                    <p className="text-[11px] text-gray-400">
                      #{it.reservation_id} · {it.unit_name}
                    </p>
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDate(it.check_in)} → {formatDate(it.check_out)}
                  </td>
                  <td>
                    <p>{it.requested_by_name || '—'}</p>
                    <p className="text-[11px] text-gray-400">{formatDateTime(it.requested_at)}</p>
                  </td>
                  <td className="max-w-[16rem]">
                    <p>{CANCEL_CHOICES[it.requested_choice] ? t(CANCEL_CHOICES[it.requested_choice]) : '—'}</p>
                    {it.reason ? <p className="text-[11px] text-gray-500 truncate">{it.reason}</p> : null}
                  </td>
                  <td className="text-right tabular-nums">{currency(it.collected)}</td>
                  <td className="text-right tabular-nums font-semibold">
                    {tab === 'pending' ? currency(it.requested_refund) : currency(it.refund_amount || 0)}
                    {tab === 'approved' && it.treasury_account_code ? (
                      <p className="text-[11px] font-normal text-gray-500">{accountLabel(it.treasury_account_code)}</p>
                    ) : null}
                  </td>
                  <td className="min-w-[13rem]"><RefundApprovalSteps item={it} /></td>
                  <td className="text-right">
                    {tab === 'pending' ? (
                      <button
                        type="button"
                        className="btn-primary text-xs disabled:opacity-50"
                        disabled={!it.manager_approved_at}
                        title={refundReady(it) ? undefined : 'Needs the reservations manager and the CEO to approve first'}
                        onClick={() =>
                          setDecide({
                            item: it,
                            refund_amount: String(Math.min(it.requested_refund, it.still_held ?? it.requested_refund)),
                            treasury_account_code: '',
                            refund_date: new Date().toISOString().slice(0, 10),
                            note: '',
                          })
                        }
                      >
                        {t('pms.fin.cancelRequests.review')}
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-500">
                        {it.decided_by_name} · {formatDateTime(it.decided_at)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></SmartTable>
        </div>
      )}

      <Modal
        open={Boolean(decide)}
        onClose={() => setDecide(null)}
        title={t('pms.fin.cancelRequests.reviewTitle')}
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDecide(null)}>
              {t('pms.fin.cancel')}
            </button>
            <button type="button" className="btn-primary" disabled={approve.isPending} onClick={submit}>
              {refundValue > 0 ? t('pms.fin.cancelRequests.approveRefund') : t('pms.fin.cancelRequests.approveKeep')}
            </button>
          </>
        }
      >
        {decide ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
              <p className="font-semibold text-soul-blue">
                {decide.item.guest_name} · {decide.item.unit_name}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                {t('pms.fin.cancelRequests.summary', {
                  collected: currency(decide.item.collected),
                  held: currency(decide.item.still_held || 0),
                  requested: currency(decide.item.requested_refund),
                })}
              </p>
              {decide.item.reason ? <p className="text-xs text-gray-600 mt-1">{decide.item.reason}</p> : null}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">{t('pms.fin.cancelRequests.refundAmount')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={decide.refund_amount}
                  onChange={(e) => setDecide((d) => ({ ...d, refund_amount: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.cancelRequests.refundDate')}</label>
                <input
                  type="date"
                  min={FINANCIAL_EPOCH}
                  className="input"
                  value={decide.refund_date}
                  onChange={(e) => setDecide((d) => ({ ...d, refund_date: e.target.value }))}
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-500 -mt-1">
              {t('pms.fin.cancelRequests.keptHint', {
                kept: currency(Math.max(0, (decide.item.still_held || 0) - refundValue)),
              })}
            </p>
            {refundValue > 0 ? (
              <div>
                <label className="label">{t('pms.fin.cancelRequests.paidFrom')} *</label>
                <SearchableSelect
                  className="w-full"
                  value={decide.treasury_account_code}
                  onChange={(v) => setDecide((d) => ({ ...d, treasury_account_code: v }))}
                  placeholder={t('pms.fin.paymentCalendar.chooseTreasury')}
                  options={treasuryOptions}
                />
              </div>
            ) : null}
            <div>
              <label className="label">{t('pms.fin.notesOptional')}</label>
              <textarea
                className="input min-h-[70px]"
                value={decide.note}
                onChange={(e) => setDecide((d) => ({ ...d, note: e.target.value }))}
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
