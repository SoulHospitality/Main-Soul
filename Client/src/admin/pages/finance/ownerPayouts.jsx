import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Copy } from 'lucide-react';
import api from '../../api/axios';
import Modal from '../../components/ui/Modal';
import { currency, formatDate } from '../../utils/formatters';
import { useFinLocale } from '../../context/FinLocaleContext';
import { PayFromModal } from './shared';

const STATUS_TONE = {
  requested: 'bg-amber-50 text-amber-800',
  approved: 'bg-sky-50 text-sky-800',
  paid: 'bg-emerald-50 text-emerald-800',
  rejected: 'bg-rose-50 text-rose-700',
  cancelled: 'bg-slate-100 text-slate-600',
};
const METHOD = { bank_transfer: 'Bank transfer', instapay: 'InstaPay', cash: 'Cash pickup' };

/**
 * Owner withdrawal requests, open ones first. Each shows where to send the money (copyable), the owner's note,
 * and whether the owner's balance still covers it. Approve, reject with a reason the owner sees, or pay from a
 * treasury with the transfer reference: one step posts the payout to the books and tells the owner.
 */
export default function OwnerPayoutQueue({ payouts }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [payTarget, setPayTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [filter, setFilter] = useState('open');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
    qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    qc.invalidateQueries({ queryKey: ['financial-system-trust'] });
  };
  const review = useMutation({
    mutationFn: ({ id, status, rejection_reason }) => api.post(`/owner/payout-requests/${id}/review`, { status, rejection_reason }),
    onSuccess: () => {
      toast.success(t('pms.fin.owners.payoutUpdated'));
      setRejectTarget(null);
      setReason('');
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const pay = useMutation({
    mutationFn: ({ id, treasury_code, payment_reference }) =>
      api.post(`/financial-system/payouts/${id}/settle`, { treasury_code, payment_reference }),
    onSuccess: () => {
      toast.success(t('pms.fin.ownerPayouts.paidToast'));
      setPayTarget(null);
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const open = payouts.filter((p) => ['requested', 'approved'].includes(p.status));
  const shown = filter === 'open' ? open : payouts;
  const openTotal = open.reduce((s, p) => s + Number(p.amount || 0), 0);

  const copy = (text) => {
    navigator.clipboard?.writeText(text).then(() => toast.success(t('pms.fin.ownerPayouts.copied'))).catch(() => {});
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-soul-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-4">
        <div>
          <h3 className="font-semibold">{t('pms.fin.owners.withdrawalRequests')}</h3>
          <p className="text-xs text-gray-500">
            {open.length
              ? t('pms.fin.ownerPayouts.openSummary', { count: open.length, amount: currency(openTotal) })
              : t('pms.fin.ownerPayouts.noneOpen')}
          </p>
        </div>
        <div className="flex gap-1 rounded-full border p-1 text-xs">
          {['open', 'all'].map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 ${filter === f ? 'bg-soul-blue text-white' : 'text-gray-600'}`}>
              {t(`pms.fin.ownerPayouts.filter.${f}`)}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">{t('pms.fin.owners.noWithdrawals')}</p>
      ) : (
        <ul className="divide-y">
          {shown.map((p) => {
            const w = p.owner_wallet;
            const covered = !w || Number(w.balance) + 0.01 >= Number(w.in_progress);
            const summary = p.details_summary || '';
            return (
              <li key={p.id} className="grid gap-3 px-6 py-4 lg:grid-cols-[1.2fr_1.4fr_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.owner_name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_TONE[p.status] || ''}`}>{t(`pms.fin.ownerPayouts.status.${p.status}`)}</span>
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{currency(p.amount)}</p>
                  <p className="text-xs text-gray-500">
                    #{p.id} · {formatDate(p.created_at)}
                    {p.status === 'paid' && p.paid_at ? ` · ${t('pms.fin.ownerPayouts.paidOn', { date: formatDate(p.paid_at) })}` : ''}
                    {p.payment_reference ? ` · ${t('pms.fin.ownerPayouts.ref')} ${p.payment_reference}` : ''}
                  </p>
                </div>

                <div className="min-w-0 space-y-1 text-sm">
                  {summary ? (
                    <button type="button" className="flex max-w-full items-center gap-2 text-left" onClick={() => copy(summary)} title={t('pms.fin.ownerPayouts.copy')}>
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{METHOD[p.payout_method] || p.payout_method}</span>
                      <span className="truncate">{summary}</span>
                      <Copy className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                    </button>
                  ) : (
                    <p className="text-xs text-amber-700">{t('pms.fin.ownerPayouts.noDetails')}</p>
                  )}
                  {p.owner_note ? <p className="text-xs text-gray-600">“{p.owner_note}”</p> : null}
                  {p.status === 'rejected' && p.rejection_reason ? <p className="text-xs text-rose-700">{p.rejection_reason}</p> : null}
                  {w && ['requested', 'approved'].includes(p.status) ? (
                    <p className={`flex items-center gap-1 text-xs ${covered ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {covered ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {t(covered ? 'pms.fin.ownerPayouts.covered' : 'pms.fin.ownerPayouts.notCovered', { balance: currency(w.balance) })}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  {p.status === 'requested' ? (
                    <>
                      <button type="button" className="btn-secondary !py-1.5 text-xs" disabled={review.isPending} onClick={() => review.mutate({ id: p.id, status: 'approved' })}>
                        {t('pms.fin.approve')}
                      </button>
                      <button type="button" className="!py-1.5 text-xs text-rose-600" onClick={() => setRejectTarget(p)}>
                        {t('pms.fin.reject')}
                      </button>
                    </>
                  ) : null}
                  {['requested', 'approved'].includes(p.status) ? (
                    <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => setPayTarget(p)}>
                      {t('pms.fin.ownerPayouts.pay')}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <PayFromModal
        open={Boolean(payTarget)}
        onClose={() => setPayTarget(null)}
        title={t('pms.fin.payFrom.payoutTitle')}
        amountLabel={payTarget ? `${payTarget.owner_name} · ${currency(payTarget.amount)} → ${payTarget.details_summary || ''}` : ''}
        withDate={false}
        withReference
        pending={pay.isPending}
        onConfirm={({ treasury_code, payment_reference }) => pay.mutate({ id: payTarget.id, treasury_code, payment_reference })}
      />

      <Modal
        open={Boolean(rejectTarget)}
        onClose={() => setRejectTarget(null)}
        title={t('pms.fin.ownerPayouts.rejectTitle')}
        size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setRejectTarget(null)}>{t('pms.fin.cancel')}</button>
            <button
              type="button"
              className="btn-primary"
              disabled={!reason.trim() || review.isPending}
              onClick={() => review.mutate({ id: rejectTarget.id, status: 'rejected', rejection_reason: reason.trim() })}
            >
              {t('pms.fin.reject')}
            </button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p className="text-gray-600">{rejectTarget ? `${rejectTarget.owner_name} · ${currency(rejectTarget.amount)}` : ''}</p>
          <label className="label">{t('pms.fin.ownerPayouts.reasonLabel')}</label>
          <textarea className="input min-h-[80px] w-full" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
