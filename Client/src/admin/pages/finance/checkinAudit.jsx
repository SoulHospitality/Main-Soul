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

export function CheckinAuditTool() {
  const { t } = useFinLocale();
  const defaults = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);
    const iso = (d) => d.toISOString().slice(0, 10);
    return { from: iso(from), to: iso(to) };
  }, []);
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [detailId, setDetailId] = useState(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['financial-system-checkin-audit', from, to],
    queryFn: () =>
      api.get('/financial-system/checkin-audit', { params: { from, to } }).then((r) => r.data),
  });

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['financial-system-checkin-audit-detail', detailId],
    queryFn: () => api.get(`/financial-system/checkin-audit/${detailId}`).then((r) => r.data),
    enabled: Boolean(detailId),
  });

  if (isLoading) return <LoadingSpinner />;
  const summary = data?.summary || {};
  const rows = data?.rows || [];

  const actionLabel = (action) => {
    const map = {
      OPS_COLLECT_CHECKIN: t('pms.fin.checkinAudit.eventCollect'),
      OPS_HANDOVER_CHECKIN: t('pms.fin.checkinAudit.eventHandover'),
      OPS_EDIT_CHECKIN_BILL: t('pms.fin.checkinAudit.eventBillEdit'),
      OPS_ASSIGN_CHECKIN: t('pms.fin.checkinAudit.eventAssign'),
      CREATE_PAYMENT: t('pms.fin.checkinAudit.eventPayment'),
      APPROVE_PAYMENT: t('pms.fin.checkinAudit.eventApprove'),
      RECORD_PAYMENT: t('pms.fin.checkinAudit.eventPayment'),
    };
    return map[action] || action;
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 max-w-3xl">{t('pms.fin.checkinAudit.description')}</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.checkinAudit.checkins')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.checkin_count || 0}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-xs text-emerald-800">{t('pms.fin.checkinAudit.doorCollected')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.money_collected_total)}</p>
        </div>
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.checkinAudit.totalPaid')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{currency(summary.amount_paid_total)}</p>
        </div>
        <div className="rounded-2xl border border-soul-line bg-white p-4">
          <p className="text-xs text-gray-400">{t('pms.fin.checkinAudit.handedOver')}</p>
          <p className="text-xl font-bold tabular-nums mt-1">{summary.handed_over_count || 0}</p>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[10px] uppercase text-gray-500">{t('pms.fin.checkinAudit.from')}</label>
          <input
            type="date"
            className="input text-sm py-1.5 mt-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="text-[10px] uppercase text-gray-500">{t('pms.fin.checkinAudit.to')}</label>
          <input
            type="date"
            className="input text-sm py-1.5 mt-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <button type="button" className="btn-secondary text-sm" onClick={() => refetch()} disabled={isFetching}>
          {t('pms.fin.checkinAudit.refresh')}
        </button>
        <div className="text-xs text-gray-500 pb-2">
          {rows.length} {t('pms.fin.checkinAudit.records')}
        </div>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <SmartTable name="checkinAudit-1"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.aging.checkIn')}</th>
                <th>{t('pms.fin.aging.guest')}</th>
                <th>{t('pms.fin.aging.unit')}</th>
                <th className="text-right">{t('pms.fin.checkinAudit.bill')}</th>
                <th className="text-right">{t('pms.fin.checkinAudit.collected')}</th>
                <th className="text-right">{t('pms.fin.checkinAudit.paid')}</th>
                <th>{t('pms.fin.checkinAudit.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-8">
                    {t('pms.fin.checkinAudit.noRows')}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.reservation_id}>
                    <td className="whitespace-nowrap">
                      <p className="font-medium">{formatDate(r.check_in)}</p>
                      <p className="text-[11px] text-gray-400">→ {formatDate(r.check_out)}</p>
                    </td>
                    <td>
                      <p className="font-medium"><TimelineLink id={r.reservation_id}>{r.guest_name || '—'}</TimelineLink></p>
                      {r.guest_phone ? <p className="text-xs text-gray-400">{r.guest_phone}</p> : null}
                    </td>
                    <td>
                      <p>{r.unit_name}</p>
                      {r.project ? <p className="text-xs text-gray-400">{r.project}</p> : null}
                    </td>
                    <td className="text-right tabular-nums font-medium">{currency(r.total_amount)}</td>
                    <td className="text-right tabular-nums">
                      <p className="font-medium text-emerald-800">{currency(r.ops_money_collected_amount)}</p>
                      {r.ops_money_collected_by_name ? (
                        <p className="text-[11px] text-gray-400">{r.ops_money_collected_by_name}</p>
                      ) : null}
                    </td>
                    <td className="text-right tabular-nums">{currency(r.amount_paid)}</td>
                    <td>
                      {r.ops_handed_over ? (
                        <span className="text-emerald-700 text-xs font-semibold">
                          {t('pms.fin.checkinAudit.handedOverBadge')}
                        </span>
                      ) : r.ops_money_collected ? (
                        <span className="text-amber-700 text-xs font-semibold">
                          {t('pms.fin.checkinAudit.collectedBadge')}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">{r.payment_status || '—'}</span>
                      )}
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn-secondary text-xs py-1 px-2"
                        onClick={() => setDetailId(r.reservation_id)}
                      >
                        {t('pms.fin.checkinAudit.viewTrail')}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table></SmartTable>
        </div>
      </div>

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title={
          detail
            ? t('pms.fin.checkinAudit.detailTitle', { id: detail.reservation_id })
            : t('pms.fin.checkinAudit.viewTrail')
        }
        size="lg"
      >
        {detailLoading || !detail ? (
          <LoadingSpinner />
        ) : (
          <div className="space-y-5 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.aging.guest')}</p>
                <p className="font-semibold">{detail.guest_name || '—'}</p>
                <p className="text-xs text-gray-500">{detail.guest_phone || ''}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.aging.unit')}</p>
                <p className="font-semibold">{detail.unit_name}</p>
                <p className="text-xs text-gray-500">{detail.project || ''}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.aging.checkIn')}</p>
                <p>{formatDate(detail.check_in)} → {formatDate(detail.check_out)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-gray-400">{t('pms.fin.checkinAudit.opsAgent')}</p>
                <p>{detail.ops_assignee_name || '—'}</p>
              </div>
            </div>

            <div className="rounded-xl border border-soul-line bg-slate-50/80 p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.bill')}</p>
                <p className="font-semibold tabular-nums">{currency(detail.total_amount)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.collected')}</p>
                <p className="font-semibold tabular-nums text-emerald-800">
                  {currency(detail.ops_money_collected_amount)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.paid')}</p>
                <p className="font-semibold tabular-nums">{currency(detail.amount_paid)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.accommodation')}</p>
                <p className="tabular-nums">{currency(detail.accommodation)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.housekeeping')}</p>
                <p className="tabular-nums">{currency(detail.housekeeping_fees)}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400">{t('pms.fin.checkinAudit.insurance')}</p>
                <p className="tabular-nums">{currency(detail.insurance)}</p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-soul-blue mb-2">{t('pms.fin.checkinAudit.payments')}</h4>
              {!detail.payments?.length ? (
                <p className="text-gray-400 text-xs">{t('pms.fin.checkinAudit.noPayments')}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-soul-line">
                  <SmartTable name="checkinAudit-2"><table className="table text-xs">
                    <thead>
                      <tr>
                        <th>{t('pms.fin.checkinAudit.when')}</th>
                        <th>{t('pms.fin.checkinAudit.method')}</th>
                        <th className="text-right">{t('pms.fin.checkinAudit.amount')}</th>
                        <th>{t('pms.fin.checkinAudit.status')}</th>
                        <th>{t('pms.fin.checkinAudit.by')}</th>
                        <th>{t('pms.fin.checkinAudit.notes')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="whitespace-nowrap">
                            {formatDateTime(p.paid_at || p.payment_date || p.created_at)}
                          </td>
                          <td>{p.payment_method || '—'}</td>
                          <td className="text-right tabular-nums font-medium">{currency(p.amount)}</td>
                          <td>{p.status || '—'}</td>
                          <td>{p.created_by_name || '—'}</td>
                          <td className="max-w-[12rem] truncate" title={p.notes || ''}>
                            {p.notes || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table></SmartTable>
                </div>
              )}
            </div>

            <div>
              <h4 className="font-semibold text-soul-blue mb-2">{t('pms.fin.checkinAudit.timeline')}</h4>
              {!detail.events?.length ? (
                <p className="text-gray-400 text-xs">{t('pms.fin.checkinAudit.noEvents')}</p>
              ) : (
                <ul className="space-y-2">
                  {detail.events.map((e) => (
                    <li
                      key={e.id}
                      className="rounded-lg border border-soul-line bg-white px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium text-soul-blue">{actionLabel(e.action)}</span>
                        <span className="text-[11px] text-gray-400">
                          {formatDateTime(e.created_at)}
                          {e.actor_name ? ` · ${e.actor_name}` : ''}
                        </span>
                      </div>
                      {e.details && typeof e.details === 'object' && Object.keys(e.details).length ? (
                        <pre className="mt-1 text-[11px] text-gray-500 whitespace-pre-wrap break-all">
                          {JSON.stringify(e.details, null, 0)}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
