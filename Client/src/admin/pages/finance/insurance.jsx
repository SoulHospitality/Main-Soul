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
import { isBankTreasury, useTreasuryOptions } from './shared';

export function InsuranceRefundsTool({ onOpenAccount }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [filter, setFilter] = useState('due');
  const [settleRow, setSettleRow] = useState(null);
  const [refundedAmount, setRefundedAmount] = useState('');
  const [damageAmount, setDamageAmount] = useState('0');
  const [method, setMethod] = useState('cash');
  const [treasury, setTreasury] = useState('');
  const [notes, setNotes] = useState('');
  const [refundDate, setRefundDate] = useState('');
  const treasuryOptions = useTreasuryOptions();

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-insurance', filter],
    queryFn: () =>
      api.get('/financial-system/insurance-refunds', { params: { filter } }).then((r) => r.data),
  });

  const settle = useMutation({
    mutationFn: ({ id, body }) => api.post(`/financial-system/insurance-refunds/${id}/settle`, body),
    onSuccess: () => {
      toast.success(t('pms.fin.insurance.settledToast'));
      setSettleRow(null);
      qc.invalidateQueries({ queryKey: ['financial-system-insurance'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.owners.failedToSettle')),
  });

  function openSettle(row) {
    const held = Number(row.insurance) || 0;
    setSettleRow(row);
    setRefundedAmount(String(held));
    setDamageAmount('0');
    setMethod('cash');
    setTreasury('');
    setNotes('');
    setRefundDate(row.check_out || new Date().toISOString().slice(0, 10));
  }

  function onDamageChange(value) {
    setDamageAmount(value);
    if (!settleRow) return;
    const held = Number(settleRow.insurance) || 0;
    const dmg = Math.max(0, parseFloat(value) || 0);
    setRefundedAmount(String(Math.max(0, Math.round((held - dmg) * 100) / 100)));
  }

  function onRefundChange(value) {
    setRefundedAmount(value);
    if (!settleRow) return;
    const held = Number(settleRow.insurance) || 0;
    const ref = Math.max(0, parseFloat(value) || 0);
    setDamageAmount(String(Math.max(0, Math.round((held - ref) * 100) / 100)));
  }

  if (isLoading) return <LoadingSpinner />;
  const summary = data?.summary || {};
  const rows = data?.rows || [];
  const filters = [
    { id: 'due', label: t('pms.fin.insurance.dueNow') },
    { id: 'upcoming', label: t('pms.fin.insurance.upcoming') },
    { id: 'settled', label: t('pms.fin.insurance.settledFilter') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-gray-500 max-w-2xl">
          {t('pms.fin.insurance.description', { code: data?.account?.code || '204000', damageCode: data?.damage_account?.code || '410000' })}
        </p>
        <button type="button" className="btn-secondary text-sm" onClick={() => onOpenAccount('204000')}>
          {t('pms.fin.insurance.openAccount')}
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-xs text-amber-800">{t('pms.fin.insurance.dueToRefund')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.due_amount)}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: summary.due_count || 0 })}</p>
        </div>
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.insurance.upcomingCheckouts')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.upcoming_amount)}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.stays', { count: summary.upcoming_count || 0 })}</p>
        </div>
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.insurance.openEscrow')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.escrow_open)}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.insurance.heldAfterCheckIn')}</p>
        </div>
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.insurance.settledRecords')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.settled_count || 0}</p>
          <p className="text-xs text-gray-500">{t('pms.fin.insurance.fullPartialForfeited')}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-full text-sm border ${
              filter === f.id
                ? 'bg-soul-blue text-white border-soul-blue'
                : 'bg-white border-soul-line text-gray-700 hover:bg-soul-blue-50/40'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <SmartTable name="insurance-1"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.aging.guest')}</th>
                <th>{t('pms.fin.aging.unit')}</th>
                <th>{t('pms.fin.aging.checkIn')}</th>
                <th>{t('pms.fin.insurance.checkout')}</th>
                <th className="text-right">{t('pms.fin.insurance.insuranceCol')}</th>
                <th>{t('pms.fin.insurance.statusCol')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-8">
                    {t('pms.fin.insurance.noRows')}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.reservation_id}>
                    <td>
                      <p className="font-medium"><TimelineLink id={r.reservation_id}>{r.guest_name || '—'}</TimelineLink></p>
                      {r.guest_phone ? <p className="text-xs text-gray-400">{r.guest_phone}</p> : null}
                    </td>
                    <td>
                      <p>{r.unit_name}</p>
                      {r.project ? <p className="text-xs text-gray-400">{r.project}</p> : null}
                    </td>
                    <td>{formatDate(r.check_in)}</td>
                    <td>{formatDate(r.check_out)}</td>
                    <td className="text-right tabular-nums font-medium">{currency(r.insurance)}</td>
                    <td className="capitalize">
                      {r.insurance_refund_status === 'pending' ? (
                        <span className="text-amber-700">{t('pms.fin.insurance.pendingRefund')}</span>
                      ) : r.insurance_refund_status === 'partial' ? (
                        <span className="text-sky-700">
                          {t('pms.fin.insurance.partial', { amount: currency(r.insurance_refunded_amount) })}
                        </span>
                      ) : r.insurance_refund_status === 'forfeited' ? (
                        <span className="text-rose-700">{t('pms.fin.insurance.forfeited')}</span>
                      ) : (
                        <span className="text-emerald-700">{t('pms.fin.insurance.refunded')}</span>
                      )}
                    </td>
                    <td className="text-right">
                      {r.insurance_refund_status === 'pending' ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2"
                          onClick={() => openSettle(r)}
                        >
                          {t('pms.fin.insurance.settleRefund')}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {r.insurance_damage_amount > 0
                            ? t('pms.fin.insurance.damage', { amount: currency(r.insurance_damage_amount) })
                            : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table></SmartTable>
        </div>
      </div>

      <Modal
        open={Boolean(settleRow)}
        onClose={() => setSettleRow(null)}
        title={t('pms.fin.insurance.settleModalTitle')}
      >
        {settleRow ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              {t('pms.fin.insurance.guestStayCheckout', { guest: settleRow.guest_name, unit: settleRow.unit_name, date: formatDate(settleRow.check_out) })}
            </p>
            <p className="text-sm">
              {t('pms.fin.insurance.heldInsurance', { amount: currency(settleRow.insurance) })}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">{t('pms.fin.insurance.refundToGuest')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={refundedAmount}
                  onChange={(e) => onRefundChange(e.target.value)}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.insurance.damageRetained')}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={damageAmount}
                  onChange={(e) => onDamageChange(e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="label">{t('pms.fin.insurance.paidFromTreasury')}</label>
                <SearchableSelect
                  className="w-full"
                  value={treasury}
                  onChange={(v) => {
                    setTreasury(v);
                    setMethod(isBankTreasury(v) ? 'bank_transfer' : 'cash');
                  }}
                  placeholder={t('pms.fin.paymentCalendar.chooseTreasury')}
                  options={treasuryOptions}
                />
              </div>
              <div>
                <label className="label">{t('pms.fin.insurance.refundDate')}</label>
                <input
                  type="date"
                  className="input"
                  value={refundDate}
                  onChange={(e) => setRefundDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="label">{t('pms.fin.notesOptional')}</label>
              <textarea
                className="input min-h-[80px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('pms.fin.insurance.damagePlaceholder')}
              />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setSettleRow(null)}>
                {t('pms.fin.cancel')}
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={settle.isPending}
                onClick={() => {
                  if ((parseFloat(refundedAmount) || 0) > 0 && !treasury) {
                    toast.error(t('pms.fin.insurance.chooseTreasury'));
                    return;
                  }
                  settle.mutate({
                    id: settleRow.reservation_id,
                    body: {
                      refunded_amount: parseFloat(refundedAmount) || 0,
                      damage_amount: parseFloat(damageAmount) || 0,
                      payment_method: method,
                      treasury_account_code: treasury || undefined,
                      refunded_at: refundDate,
                      notes: notes || undefined,
                    },
                  });
                }}
              >
                {t('pms.fin.insurance.confirmSettle')}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
