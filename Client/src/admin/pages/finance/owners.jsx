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
import { rangeParams } from './shared';

export function OwnerStatementsTab({ fromDate, toDate, rangeParams: params }) {
  const { t } = useFinLocale();
  const [unitId, setUnitId] = useState('');
  const [settleOwner, setSettleOwner] = useState(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleNotes, setSettleNotes] = useState('');
  const qc = useQueryClient();
  const { data: units = [] } = useQuery({
    queryKey: ['financial-system-units'],
    queryFn: () => api.get('/financial-system/units').then((r) => r.data),
  });
  const q = { ...params, unit_id: unitId || undefined };
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-owners', fromDate, toDate, params.basis, unitId],
    queryFn: () => api.get('/financial-system/owner-statements', { params: q }).then((r) => r.data),
  });
  const settle = useMutation({
    mutationFn: (id) => api.post(`/financial-system/payouts/${id}/settle`),
    onSuccess: () => {
      toast.success(t('pms.fin.owners.markSettled'));
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const settleOwnerMutation = useMutation({
    mutationFn: ({ ownerId, amount, notes }) =>
      api.post(
        `/financial-system/owners/${ownerId}/settle`,
        { amount, notes },
        { params }
      ),
    onSuccess: (res) => {
      toast.success(t('pms.fin.owners.settledFor', { amount: currency(res.data?.amount), name: res.data?.owner?.full_name || t('pms.fin.owners.ownerFallback') }));
      setSettleOwner(null);
      setSettleAmount('');
      setSettleNotes('');
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.owners.failedToSettle')),
  });
  const reviewPayout = useMutation({
    mutationFn: ({ id, status }) => api.post(`/owner/payout-requests/${id}/review`, { status }),
    onSuccess: () => {
      toast.success(t('pms.fin.owners.payoutUpdated'));
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  if (isLoading) return <LoadingSpinner />;
  const statements = data?.statements || [];
  const ownerBalances = data?.owner_balances || [];
  const payouts = data?.payouts || [];

  function openSettle(owner) {
    setSettleOwner(owner);
    setSettleAmount(
      owner.remaining != null && owner.remaining > 0 ? String(owner.remaining) : ''
    );
    setSettleNotes('');
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        {t('pms.fin.owners.description')}
      </p>
      <SearchableSelect
        className="w-72"
        value={unitId}
        onChange={setUnitId}
        placeholder={t('pms.fin.owners.allUnits')}
        options={[
          { value: '', label: t('pms.fin.owners.allUnits') },
          ...units.map((u) => ({
            value: String(u.id),
            label: `${u.project ? `${u.project} — ` : ''}${u.unit_name}`,
          })),
        ]}
      />

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">{t('pms.fin.owners.settleByOwner')}</h3>
          <p className="text-xs text-gray-500 mt-1">
            {t('pms.fin.owners.settleByOwnerHint')}
          </p>
        </div>
        <div className="overflow-x-auto">
          <SmartTable name="owners-1"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.owners.owner')}</th>
                <th className="text-right">{t('pms.fin.owners.earned')}</th>
                <th className="text-right">{t('pms.fin.owners.alreadyPaid')}</th>
                <th className="text-right">{t('pms.fin.owners.remaining')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ownerBalances.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-sm text-gray-400 py-8">
                    {t('pms.fin.owners.noOwnerBalances')}
                  </td>
                </tr>
              ) : (
                ownerBalances.map((o) => (
                  <tr key={o.owner_id}>
                    <td className="font-medium">{o.full_name}</td>
                    <td className="text-right tabular-nums">{currency(o.earned)}</td>
                    <td className="text-right tabular-nums text-emerald-700">
                      {o.paid_out > 0 ? currency(o.paid_out) : '—'}
                    </td>
                    <td className="text-right font-bold tabular-nums">{currency(o.remaining)}</td>
                    <td className="text-right">
                      {o.remaining > 0.009 ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2"
                          onClick={() => openSettle(o)}
                        >
                          <CheckCircle2 className="w-3 h-3 inline mr-1" />
                          {t('pms.fin.owners.customSettle')}
                        </button>
                      ) : (
                        <span className="text-xs text-emerald-600 font-medium">{t('pms.fin.owners.settled')}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table></SmartTable>
        </div>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">{t('pms.fin.owners.ownerBalancesByUnit')}</h3>
        </div>
        <div className="overflow-x-auto">
          <SmartTable name="owners-2"><table className="table text-sm">
            <thead>
              <tr>
                <th>{t('pms.fin.owners.unitCol')}</th>
                <th>{t('pms.fin.owners.owner')}</th>
                <th className="text-right">{t('pms.fin.owners.credits')}</th>
                <th className="text-right">{t('pms.fin.owners.maintenance')}</th>
                <th className="text-right">{t('pms.fin.owners.netDue')}</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((s) => (
                <tr key={s.unit_id}>
                  <td className="font-medium">{s.unit_name}</td>
                  <td>{s.owner_names}</td>
                  <td className="text-right tabular-nums">{currency(s.gross_credits)}</td>
                  <td className="text-right tabular-nums text-rose-600">
                    {s.maintenance_deductions > 0 ? `−${currency(s.maintenance_deductions)}` : '—'}
                  </td>
                  <td className="text-right font-bold tabular-nums">{currency(s.net_payout_due)}</td>
                </tr>
              ))}
            </tbody>
          </table></SmartTable>
        </div>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">{t('pms.fin.owners.withdrawalRequests')}</div>
        <SmartTable name="owners-3"><table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.owners.owner')}</th>
              <th className="text-right">{t('pms.fin.amount')}</th>
              <th>{t('pms.fin.owners.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payouts.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center text-sm text-gray-400 py-6">
                  {t('pms.fin.owners.noWithdrawals')}
                </td>
              </tr>
            ) : (
              payouts.map((p) => (
                <tr key={p.id}>
                  <td>{p.owner_name}</td>
                  <td className="text-right tabular-nums">{currency(p.amount)}</td>
                  <td className="capitalize">{p.status}</td>
                  <td className="text-right space-x-2">
                    {p.status === 'requested' && (
                      <>
                        <button
                          type="button"
                          className="text-xs text-emerald-700"
                          onClick={() => reviewPayout.mutate({ id: p.id, status: 'approved' })}
                        >
                          {t('pms.fin.approve')}
                        </button>
                        <button
                          type="button"
                          className="text-xs text-red-600"
                          onClick={() => reviewPayout.mutate({ id: p.id, status: 'rejected' })}
                        >
                          {t('pms.fin.reject')}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-xs py-1 px-2"
                          onClick={() => settle.mutate(p.id)}
                        >
                          {t('pms.fin.owners.markSettled')}
                        </button>
                      </>
                    )}
                    {p.status === 'approved' && (
                      <button
                        type="button"
                        className="btn-secondary text-xs py-1 px-2"
                        onClick={() => settle.mutate(p.id)}
                      >
                        <CheckCircle2 className="w-3 h-3 inline mr-1" />
                        {t('pms.fin.owners.markSettled')}
                      </button>
                    )}
                    {p.status === 'paid' && (
                      <span className="text-xs text-emerald-600 font-medium">{t('pms.fin.owners.paid')}</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table></SmartTable>
      </div>

      <Modal
        open={Boolean(settleOwner)}
        onClose={() => setSettleOwner(null)}
        title={settleOwner ? t('pms.fin.owners.settleModalTitle', { name: settleOwner.full_name }) : t('pms.fin.owners.settleOwnerFallback')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setSettleOwner(null)}>
              {t('pms.fin.cancel')}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={settleOwnerMutation.isPending || !(parseFloat(settleAmount) > 0)}
              onClick={() =>
                settleOwnerMutation.mutate({
                  ownerId: settleOwner.owner_id,
                  amount: parseFloat(settleAmount),
                  notes: settleNotes || undefined,
                })
              }
            >
              {settleOwnerMutation.isPending ? t('pms.fin.owners.saving') : t('pms.fin.owners.confirmSettled')}
            </button>
          </>
        }
      >
        {settleOwner && (
          <div className="space-y-4 text-sm">
            <p className="text-gray-600">
              {t('pms.fin.owners.settleDescription', { remaining: currency(settleOwner.remaining) })}
            </p>
            <div>
              <label className="label">{t('pms.fin.amountEgp')}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input w-full"
                value={settleAmount}
                onChange={(e) => setSettleAmount(e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t('pms.fin.notesOptional')}</label>
              <input
                className="input w-full"
                value={settleNotes}
                onChange={(e) => setSettleNotes(e.target.value)}
                placeholder={t('pms.fin.owners.notesPlaceholder')}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function OwnerTrustTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [form, setForm] = useState({ owner_id: '', amount: '', reason: '' });
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-trust', params],
    queryFn: () => api.get('/financial-system/owner-trust', { params }).then((r) => r.data),
  });
  const { data: owners = [] } = useQuery({
    queryKey: ['users-owners'],
    queryFn: () => api.get('/users/owners').then((r) => r.data),
  });
  const addHb = useMutation({
    mutationFn: (payload) => api.post('/financial-system/holdbacks', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.trust.holdbackRecorded'));
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const release = useMutation({
    mutationFn: (id) => api.post(`/financial-system/holdbacks/${id}/release`),
    onSuccess: () => {
      toast.success(t('pms.fin.trust.holdbackReleased'));
      qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
  });
  if (isLoading) return <LoadingSpinner />;
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-soul-line bg-white p-5 flex flex-wrap gap-6">
        <div>
          <p className="text-xs text-gray-400">{t('pms.fin.trust.controlAccount')}</p>
          <p className="text-2xl font-bold tabular-nums">{currency(data?.control_202000)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400">{t('pms.fin.trust.subLedgerTied')}</p>
          <p className="text-2xl font-bold">{data?.tied ? t('pms.fin.trust.yes') : t('pms.fin.trust.check')}</p>
        </div>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.trust.ownerTrustSubLedger')}</div>
        <SmartTable name="owners-4"><table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.trust.owner')}</th>
              <th className="text-right">{t('pms.fin.trust.credits')}</th>
              <th className="text-right">{t('pms.fin.trust.payouts')}</th>
              <th className="text-right">{t('pms.fin.trust.holdbacks')}</th>
              <th className="text-right">{t('pms.fin.trust.charges')}</th>
              <th className="text-right">{t('pms.fin.balance')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.owners || []).map((o) => (
              <tr key={o.owner_id || o.owner_name}>
                <td>{o.owner_name}</td>
                <td className="text-right tabular-nums">{currency(o.credits)}</td>
                <td className="text-right tabular-nums">{currency(o.payouts)}</td>
                <td className="text-right tabular-nums">{currency(o.holdbacks)}</td>
                <td className="text-right tabular-nums">{currency(o.expenses)}</td>
                <td className="text-right tabular-nums font-bold">{currency(o.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table></SmartTable>
      </div>
      <div className="rounded-2xl border border-soul-line bg-white p-5 space-y-3">
        <h3 className="font-semibold">{t('pms.fin.trust.holdBackTitle')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <SearchableSelect
            className="w-full"
            value={form.owner_id}
            onChange={(v) => setForm((f) => ({ ...f, owner_id: v }))}
            placeholder={t('pms.fin.trust.ownerPlaceholder')}
            options={(Array.isArray(owners) ? owners : []).map((o) => ({
              value: String(o.id),
              label: o.full_name || o.name,
            }))}
          />
          <input type="number" className="input" placeholder={t('pms.fin.amount')} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
          <input className="input" placeholder={t('pms.fin.trust.reason')} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          <button
            type="button"
            className="btn-primary"
            disabled={addHb.isPending}
            onClick={() => addHb.mutate({ owner_id: parseInt(form.owner_id, 10), amount: parseFloat(form.amount), reason: form.reason })}
          >
            {t('pms.fin.trust.holdBack')}
          </button>
        </div>
        <SmartTable name="owners-5"><table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.trust.owner')}</th>
              <th className="text-right">{t('pms.fin.amount')}</th>
              <th>{t('pms.fin.trust.reason')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data?.holdbacks || []).map((h) => (
              <tr key={h.id}>
                <td>{h.owner_name}</td>
                <td className="text-right tabular-nums">{currency(h.amount)}</td>
                <td>{h.reason || '—'} {Number(h.is_released) === 1 ? t('pms.fin.trust.released') : ''}</td>
                <td className="text-right">
                  {Number(h.is_released) !== 1 && (
                    <button type="button" className="text-xs text-emerald-700" onClick={() => release.mutate(h.id)}>
                      {t('pms.fin.trust.release')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></SmartTable>
      </div>
    </div>
  );
}
