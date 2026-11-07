import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle, ReceiptText } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import Modal from './ui/Modal';
import { currency, formatDate, formatDateTime } from '../utils/formatters';

/** Both approvals are in: finance can pay the refund. */
export function refundReady(it) {
  return Boolean(it?.manager_approved_at && it?.admin_approved_at);
}

function useApproveStep() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, step }) => api.post(`/financial-system/cancel-requests/${id}/approve-step`, { step }),
    onSuccess: (_r, vars) => {
      toast.success(vars.step === 'admin' ? 'Approved by the CEO' : 'Approved by the reservations manager');
      qc.invalidateQueries({ queryKey: ['financial-system-cancel-requests'] });
      qc.invalidateQueries({ queryKey: ['refund-approvals'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not approve'),
  });
}

/** The two approvals (reservations manager, then CEO), with a button for whoever's turn it is. */
export function RefundApprovalSteps({ item }) {
  const { user } = useAuth();
  const step = useApproveStep();
  const role = user?.role;
  const rows = [
    {
      key: 'manager',
      label: 'Reservations manager',
      at: item.manager_approved_at,
      by: item.manager_approved_by_name,
      can: role === 'reservations_manager' || role === 'admin',
    },
    { key: 'admin', label: 'CEO', at: item.admin_approved_at, by: item.admin_approved_by_name, can: role === 'admin' },
  ];
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-1.5 text-[11px]">
          {r.at ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Circle className="h-3.5 w-3.5 text-gray-300" />}
          <span className={r.at ? 'text-gray-700' : 'text-gray-400'}>
            {r.label}
            {r.at ? ` · ${r.by || ''}` : ''}
          </span>
          {!r.at && r.can && item.status === 'pending' ? (
            <button
              type="button"
              disabled={step.isPending || (r.key === 'admin' && !item.manager_approved_at && role !== 'admin')}
              onClick={() => step.mutate({ id: item.id, step: r.key })}
              className="ml-1 rounded-md bg-soul-blue px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-soul-blue/90 disabled:opacity-50"
            >
              Approve
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Button + list for the reservations manager and the CEO on the Reservations page. */
export function RefundApprovalsButton() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const allowed = user?.role === 'admin' || user?.role === 'reservations_manager';
  const { data } = useQuery({
    queryKey: ['refund-approvals'],
    queryFn: () => api.get('/financial-system/cancel-requests').then((r) => r.data),
    enabled: allowed,
    refetchInterval: 60000,
  });
  if (!allowed) return null;
  const items = data?.items || [];
  const waiting = items.filter((it) => (user.role === 'admin' ? !it.admin_approved_at : !it.manager_approved_at)).length;
  return (
    <>
      <button type="button" className="btn-secondary relative" onClick={() => setOpen(true)} title="Refunds waiting for approval">
        <ReceiptText className="h-4 w-4" /> Refunds
        {waiting ? (
          <span className="ml-1 rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">{waiting}</span>
        ) : null}
      </button>
      {open ? (
        <Modal open onClose={() => setOpen(false)} title="Refund requests" size="lg">
          <p className="mb-3 text-sm text-gray-500">
            Cancelled reservations with money paid. The reservations manager approves, then the CEO; finance then pays the refund.
          </p>
          {!items.length ? (
            <p className="py-8 text-center text-sm text-gray-400">No refund requests waiting.</p>
          ) : (
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.id} className="grid gap-2 rounded-xl border border-soul-line p-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-medium text-soul-blue">
                      {it.guest_name || 'Guest'} <span className="text-xs font-normal text-gray-400">#{it.reservation_id} · {it.unit_name}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDate(it.check_in)} → {formatDate(it.check_out)} · paid {currency(it.collected)} · refund asked{' '}
                      <b className="text-gray-800">{currency(it.requested_refund)}</b>
                    </p>
                    <p className="text-[11px] text-gray-400">
                      Cancelled by {it.requested_by_name || '—'} · {formatDateTime(it.requested_at)}
                      {it.reason ? ` · ${it.reason}` : ''}
                    </p>
                  </div>
                  <RefundApprovalSteps item={it} />
                </div>
              ))}
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}
