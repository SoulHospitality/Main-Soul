import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { ArrowDownToLine, Banknote, CheckCircle2, Circle, Clock, FileText, Landmark, Pencil, Smartphone, Wallet, XCircle } from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import { useAuth } from '../../../context/AuthContext';
import { STATUS, METHOD_LABEL, egp, detailsLine, openPayoutReceipt } from './ownerMoney';

const EMPTY = { method: 'bank_transfer', bank_name: '', account_name: '', account_number: '', iban: '', instapay: '', phone: '' };

function Row({ label, value, tone, strong }) {
  return (
    <div className={`flex items-center justify-between gap-4 py-2 text-sm ${strong ? 'border-t border-soul-line pt-3 font-semibold' : ''}`}>
      <span className="text-soul-muted">{label}</span>
      <span className={`tabular-nums ${tone || 'text-soul-blue'}`}>{value}</span>
    </div>
  );
}

function PayoutDetailsForm({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  const methods = [
    ['bank_transfer', 'Bank transfer', Landmark],
    ['instapay', 'InstaPay', Smartphone],
    ['cash', 'Cash pickup', Banknote],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {methods.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange({ ...value, method: id })}
            className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-xs font-medium ${value.method === id ? 'border-soul-blue bg-soul-blue/5 text-soul-blue' : 'border-soul-line text-soul-muted'}`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>
      {value.method === 'bank_transfer' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input" placeholder="Bank (e.g. CIB)" value={value.bank_name || ''} onChange={set('bank_name')} />
          <input className="input" placeholder="Account holder name" value={value.account_name || ''} onChange={set('account_name')} />
          <input className="input" placeholder="Account number" value={value.account_number || ''} onChange={set('account_number')} />
          <input className="input" placeholder="IBAN (EG…)" value={value.iban || ''} onChange={set('iban')} />
        </div>
      ) : value.method === 'instapay' ? (
        <input className="input w-full" placeholder="InstaPay address or phone" value={value.instapay || ''} onChange={set('instapay')} />
      ) : (
        <input className="input w-full" placeholder="Phone we call when the cash is ready" value={value.phone || ''} onChange={set('phone')} />
      )}
    </div>
  );
}

function Timeline({ r }) {
  const steps = [
    ['Requested', r.created_at, true],
    ['Approved', r.reviewed_at, ['approved', 'paid'].includes(r.status)],
    ['Paid', r.paid_at, r.status === 'paid'],
  ];
  if (r.status === 'rejected' || r.status === 'cancelled') {
    return (
      <p className="text-xs text-soul-muted">
        {r.status === 'rejected' ? `Not approved${r.rejection_reason ? `: ${r.rejection_reason}` : ''}` : 'You cancelled this request.'}
      </p>
    );
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {steps.map(([label, at, done], i) => (
        <li key={label} className={`flex items-center gap-1 ${done ? 'text-emerald-700' : 'text-soul-muted'}`}>
          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
          {label}
          {done && at ? <span className="text-soul-muted">· {new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span> : null}
          {i < steps.length - 1 ? <span className="ms-2 text-slate-300">—</span> : null}
        </li>
      ))}
    </ol>
  );
}

export default function OwnerPayouts() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['owner-wallet'],
    queryFn: () => api.get('/owner/wallet').then((r) => r.data),
  });
  const wallet = data?.wallet;
  const saved = data?.payout_details;
  const [details, setDetails] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (saved) setDetails({ ...EMPTY, ...saved });
    else setEditing(true);
  }, [saved]);

  // Opening this page reads the payout updates (clears the badge in the menu).
  const { data: notes } = useQuery({
    queryKey: ['owner-payout-notifications'],
    queryFn: async () => (await api.get('/notifications', { params: { limit: 30 } })).data,
  });
  useEffect(() => {
    const unread = (notes?.notifications || []).filter((n) => n.entity_type === 'owner_payout_request' && !Number(n.is_read));
    if (!unread.length) return;
    Promise.all(unread.map((n) => api.put(`/notifications/${n.id}/read`).catch(() => null))).then(() =>
      qc.invalidateQueries({ queryKey: ['owner-payout-notifications'] })
    );
  }, [notes, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['owner-wallet'] });
    qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
  };
  const saveDetails = useMutation({
    mutationFn: () => api.put('/owner/payout-details', details).then((r) => r.data),
    onSuccess: () => {
      toast.success('Payout details saved');
      setEditing(false);
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not save'),
  });
  const request = useMutation({
    mutationFn: () =>
      api.post('/owner/payout-requests', {
        amount: Number(amount),
        note: note || undefined,
        payout_details: editing ? details : undefined,
      }),
    onSuccess: () => {
      toast.success('Request sent. The finance team will review it.');
      setAmount('');
      setNote('');
      setConfirm(false);
      setEditing(false);
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Request not sent'),
  });
  const cancel = useMutation({
    mutationFn: (id) => api.post(`/owner/payout-requests/${id}/cancel`),
    onSuccess: () => {
      toast.success('Request cancelled');
      refresh();
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not cancel'),
  });

  const requests = data?.requests || [];
  const open = useMemo(() => requests.filter((r) => ['requested', 'approved'].includes(r.status)), [requests]);
  if (isLoading) return <LoadingSpinner />;

  const available = wallet?.available || 0;
  const amt = Number(amount);
  const tooMuch = amt > available + 0.009;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-soul-blue">Payouts</h1>
        <p className="mt-1 text-sm text-soul-muted">Your balance, where we send your money, and every request.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-2xl bg-gradient-to-br from-[#0b2f4a] to-[#0b4f73] p-6 text-white shadow-lg">
          <p className="text-xs uppercase tracking-[0.18em] text-white/70">Available to request</p>
          <p className="mt-2 text-4xl font-semibold tabular-nums">{egp(available)}</p>
          <p className="mt-2 text-sm text-white/75">
            From stays that have checked out. {wallet?.upcoming > 0 ? `${egp(wallet.upcoming)} more from ${wallet.upcoming_stays} upcoming stay${wallet.upcoming_stays === 1 ? '' : 's'} becomes available after check-out.` : ''}
          </p>
          {open.length ? (
            <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs">
              <Clock className="h-3.5 w-3.5" /> {egp(wallet?.in_progress)} in progress
            </p>
          ) : null}
        </section>

        <section className="card">
          <h2 className="mb-2 font-semibold text-soul-blue">How it adds up</h2>
          <Row label="Your share of finished stays" value={egp(wallet?.earned)} />
          <Row label="Expenses charged to you" value={`− ${egp(wallet?.expenses)}`} tone="text-rose-700" />
          <Row label="Already paid to you" value={`− ${egp(wallet?.paid_out)}`} tone="text-rose-700" />
          <Row label="Requests in progress" value={`− ${egp(wallet?.in_progress)}`} tone="text-amber-700" />
          <Row label="Available now" value={egp(available)} strong tone="text-emerald-700" />
          <p className="mt-2 text-xs text-soul-muted">
            {wallet?.since
              ? `Counted since ${new Date(`${wallet.since}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}, when the current books started. Earlier stays and payouts are on your Statement page.`
              : 'Your full history is on the Statement page.'}
          </p>
        </section>
      </div>

      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold text-soul-blue"><Wallet className="h-4 w-4" /> Request a payout</h2>
        </div>

        <div className="rounded-xl border border-soul-line p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-soul-blue">Paid to</p>
            {saved && !editing ? (
              <button type="button" className="inline-flex items-center gap-1 text-xs text-soul-blue" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" /> Change
              </button>
            ) : null}
          </div>
          {saved && !editing ? (
            <p className="text-sm text-soul-muted">
              <span className="font-medium text-soul-blue">{METHOD_LABEL[saved.method]}</span> · {detailsLine(saved)}
            </p>
          ) : (
            <div className="space-y-3">
              <PayoutDetailsForm value={details} onChange={setDetails} />
              <div className="flex justify-end gap-2">
                {saved ? <button type="button" className="btn-secondary text-sm" onClick={() => { setDetails({ ...EMPTY, ...saved }); setEditing(false); }}>Cancel</button> : null}
                <button type="button" className="btn-secondary text-sm" disabled={saveDetails.isPending} onClick={() => saveDetails.mutate()}>Save details</button>
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="label">Amount (EGP)</label>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="1"
                className={`input flex-1 ${tooMuch ? 'border-rose-400' : ''}`}
                value={amount}
                placeholder={available ? String(Math.floor(available)) : '0'}
                onChange={(e) => setAmount(e.target.value)}
              />
              <button type="button" className="btn-secondary text-sm" disabled={!(available > 0)} onClick={() => setAmount(String(available))}>
                All
              </button>
            </div>
            {tooMuch ? <p className="mt-1 text-xs text-rose-600">You can request up to {egp(available)} now.</p> : null}
          </div>
        </div>
        <div>
          <label className="label">Note for the finance team (optional)</label>
          <input className="input w-full" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-sm text-soul-muted">
          <input type="checkbox" className="mt-1" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          I confirm the account above is mine and the amount is correct.
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-soul-muted">Finance reviews requests on working days; you get a notification when it’s approved and when it’s sent.</p>
          <button
            type="button"
            className="btn-primary"
            disabled={!(amt > 0) || tooMuch || !confirm || request.isPending || (!saved && !editing)}
            onClick={() => request.mutate()}
          >
            <ArrowDownToLine className="h-4 w-4" /> {request.isPending ? 'Sending…' : `Request ${amt > 0 ? egp(amt) : 'payout'}`}
          </button>
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold text-soul-blue">Your requests</h2>
        {requests.length === 0 ? (
          <p className="py-6 text-center text-sm text-soul-muted">No payout requests yet.</p>
        ) : (
          <ul className="divide-y divide-soul-line">
            {requests.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold tabular-nums text-soul-blue">{egp(r.amount)}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS[r.status]?.tone || ''}`}>{STATUS[r.status]?.label || r.status}</span>
                    <span className="text-xs text-soul-muted">#{r.id} · {new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                  </div>
                  <Timeline r={r} />
                  {r.payout_details ? <p className="truncate text-xs text-soul-muted">{METHOD_LABEL[r.payout_method] || ''} · {detailsLine(r.payout_details)}</p> : null}
                  {r.status === 'paid' && r.payment_reference ? <p className="text-xs text-soul-muted">Reference {r.payment_reference}</p> : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  {['requested', 'approved'].includes(r.status) ? (
                    <button type="button" className="btn-secondary text-xs" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>
                      <XCircle className="h-3.5 w-3.5" /> Cancel
                    </button>
                  ) : null}
                  {r.status === 'paid' ? (
                    <button type="button" className="btn-secondary text-xs" onClick={() => openPayoutReceipt(r, user?.full_name) || toast.error('Allow pop-ups to open the receipt')}>
                      <FileText className="h-3.5 w-3.5" /> Receipt
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
