import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Landmark,
  LayoutDashboard,
  SplitSquareHorizontal,
  FileText,
  BookOpen,
  Scale,
  Download,
  CheckCircle2,
  PenLine,
  Plus,
  Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import SearchableSelect from '../components/ui/SearchableSelect';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import Modal from '../components/ui/Modal';
import { currency, formatDate } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import { accountsByGroup } from '../../lib/finance/chartOfAccounts';
import { VAT_OUTPUT_PCT, WHT_STANDARD_PCT, WHT_REDUCED_PCT } from '../../lib/finance/taxEngine';

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'splits', label: 'Booking splits', icon: SplitSquareHorizontal },
  { id: 'owners', label: 'Owner payouts', icon: FileText },
  { id: 'manual', label: 'Manual entries', icon: PenLine },
  { id: 'ledger', label: 'Accounts', icon: BookOpen },
  { id: 'tax', label: 'Tax', icon: Scale },
];

const ENTRY_TYPE_LABELS = {
  revenue: 'Custom revenue',
  expense: 'Custom expense',
};

function KpiCard({ label, amount, sub, tone = 'slate' }) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    blue: 'border-soul-blue/25 bg-soul-blue-50/40',
    emerald: 'border-emerald-200 bg-emerald-50/50',
    amber: 'border-amber-200 bg-amber-50/50',
    violet: 'border-violet-200 bg-violet-50/50',
  };
  return (
    <div className={`rounded-2xl border p-5 ${tones[tone] || tones.slate}`}>
      <p className="text-xs font-medium text-gray-600">{label}</p>
      <p className="text-2xl font-bold tabular-nums text-gray-900 mt-2">{currency(amount)}</p>
      {sub ? <p className="text-xs text-gray-500 mt-1">{sub}</p> : null}
    </div>
  );
}

function DateFilters({ fromDate, toDate, onFrom, onTo }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-gray-500">From</label>
      <input
        type="date"
        className="input w-36 text-sm"
        min={FINANCIAL_EPOCH}
        value={fromDate}
        onChange={(e) => onFrom(e.target.value)}
      />
      <label className="text-xs text-gray-500">To</label>
      <input
        type="date"
        className="input w-36 text-sm"
        value={toDate}
        onChange={(e) => onTo(e.target.value)}
      />
    </div>
  );
}

function OverviewTab({ fromDate, toDate, rangeParams }) {
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-overview', fromDate, toDate],
    queryFn: () =>
      api.get('/financial-system/overview', { params: rangeParams }).then((r) => r.data),
    refetchInterval: 60_000,
  });

  async function exportReport() {
    try {
      setExporting(true);
      const res = await api.get('/financial-system/export', {
        params: rangeParams,
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'soul-financial-system.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (isLoading) return <LoadingSpinner />;

  const kpis = data?.kpis || {};
  const sup = data?.supplemental || {};
  const cards = [
    { key: 'owner_trust', tone: 'blue' },
    { key: 'guest_deposits', tone: 'emerald' },
    { key: 'commission', tone: 'violet' },
    { key: 'vat_payable', tone: 'amber' },
    { key: 'wht_payable', tone: 'slate' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Period: {data?.from_date}
          {data?.to_date ? ` → ${data.to_date}` : ' → open'} · Books from {FINANCIAL_EPOCH}
        </p>
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={exportReport}
          disabled={exporting}
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting…' : 'Export Excel'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        {cards.map(({ key, tone }) => {
          const k = kpis[key] || {};
          return (
            <KpiCard key={key} label={k.label} amount={k.amount} sub={k.sub} tone={tone} />
          );
        })}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Cash position</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Outstanding from guests</p>
            <p className="text-xl font-bold mt-1 tabular-nums">{currency(sup.guest_receivable)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Online payments cleared</p>
            <p className="text-xl font-bold mt-1 tabular-nums">{currency(sup.gateway_clearing)}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs uppercase tracking-wider text-gray-500">Owner withdrawals pending</p>
            <p className="text-xl font-bold mt-1 tabular-nums">
              {currency(sup.pending_owner_payouts)}
            </p>
          </div>
        </div>
      </div>

      {(data?.manual?.revenue > 0 || data?.manual?.expense > 0) && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Manual adjustments</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card p-4 border-l-4 border-emerald-400">
              <p className="text-xs uppercase tracking-wider text-gray-500">Custom revenue</p>
              <p className="text-xl font-bold mt-1 tabular-nums text-emerald-800">
                {currency(data.manual.revenue)}
              </p>
            </div>
            <div className="card p-4 border-l-4 border-rose-400">
              <p className="text-xs uppercase tracking-wider text-gray-500">Custom expense</p>
              <p className="text-xl font-bold mt-1 tabular-nums text-rose-800">
                {currency(data.manual.expense)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function BookingSplitsTab({ rangeParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-splits', rangeParams],
    queryFn: () =>
      api.get('/financial-system/booking-splits', { params: rangeParams }).then((r) => r.data),
  });

  const splits = data?.splits || [];

  const totals = useMemo(() => {
    return splits.reduce(
      (acc, s) => {
        acc.gross += s.gross_booking || 0;
        acc.commission += s.soul_commission || 0;
        acc.cleaning += s.cleaning_fee || 0;
        acc.vat += s.vat_on_commission || 0;
        acc.owner += s.owner_trust_credit || 0;
        return acc;
      },
      { gross: 0, commission: 0, cleaning: 0, vat: 0, owner: 0 }
    );
  }, [splits]);

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ['Gross', totals.gross],
          ['Commission', totals.commission],
          ['Cleaning', totals.cleaning],
          ['VAT', totals.vat],
          ['Owner share', totals.owner],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
            <p className="text-sm font-bold tabular-nums mt-0.5">{currency(value)}</p>
          </div>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">How each booking is split</h3>
          <p className="text-xs text-gray-500 mt-1">
            Gross → Soul commission → cleaning → {VAT_OUTPUT_PCT}% VAT → owner share
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Guest / Unit</th>
                <th>Stay</th>
                <th className="text-right">Gross</th>
                <th className="text-right">Commission</th>
                <th className="text-right">Cleaning</th>
                <th className="text-right">VAT</th>
                <th className="text-right">Owner share</th>
                <th>Channel</th>
              </tr>
            </thead>
            <tbody>
              {splits.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-8">
                    No bookings in this period
                  </td>
                </tr>
              ) : (
                splits.map((s) => (
                  <tr key={s.reservation_id}>
                    <td>
                      <div className="font-medium text-gray-900">{s.guest_name}</div>
                      <div className="text-xs text-gray-500">
                        {s.unit_name} · {s.project}
                      </div>
                    </td>
                    <td className="text-xs whitespace-nowrap">
                      {formatDate(s.check_in)} → {formatDate(s.check_out)}
                    </td>
                    <td className="text-right tabular-nums">{currency(s.gross_booking)}</td>
                    <td className="text-right tabular-nums text-violet-700">
                      {currency(s.soul_commission)}
                      <span className="text-gray-400 text-xs ml-1">({s.soul_commission_pct}%)</span>
                    </td>
                    <td className="text-right tabular-nums">{currency(s.cleaning_fee)}</td>
                    <td className="text-right tabular-nums text-amber-700">
                      {currency(s.vat_on_commission)}
                    </td>
                    <td className="text-right tabular-nums font-semibold text-soul-blue">
                      {currency(s.owner_trust_credit)}
                    </td>
                    <td>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          s.from_website
                            ? 'bg-sky-100 text-sky-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {s.from_website ? 'Website' : 'Manual'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-3 border-t bg-gray-50 text-xs text-gray-500">
          {splits.length} bookings
        </div>
      </div>
    </div>
  );
}

function OwnerStatementsTab({ fromDate, toDate, rangeParams }) {
  const [unitId, setUnitId] = useState('');
  const qc = useQueryClient();

  const { data: units = [] } = useQuery({
    queryKey: ['financial-system-units'],
    queryFn: () => api.get('/financial-system/units').then((r) => r.data),
  });

  const params = { ...rangeParams, unit_id: unitId || undefined };
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-owners', fromDate, toDate, unitId],
    queryFn: () =>
      api.get('/financial-system/owner-statements', { params }).then((r) => r.data),
  });

  const settle = useMutation({
    mutationFn: (id) => api.post(`/financial-system/payouts/${id}/settle`),
    onSuccess: () => {
      toast.success('Payout marked settled');
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  const reviewPayout = useMutation({
    mutationFn: ({ id, status }) =>
      api.post(`/owner/payout-requests/${id}/review`, { status }),
    onSuccess: () => {
      toast.success('Payout updated');
      qc.invalidateQueries({ queryKey: ['financial-system-owners'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed'),
  });

  if (isLoading) return <LoadingSpinner />;

  const statements = data?.statements || [];
  const payouts = data?.payouts || [];

  return (
    <div className="space-y-6">
      <SearchableSelect
        className="w-72"
        value={unitId}
        onChange={setUnitId}
        placeholder="All units"
        options={[
          { value: '', label: 'All units' },
          ...units.map((u) => ({
            value: String(u.id),
            label: `${u.project ? `${u.project} — ` : ''}${u.unit_name}`,
          })),
        ]}
      />

      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">Owner balances by unit</h3>
          <p className="text-xs text-gray-500">
            Owner share from stays minus maintenance they pay for
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Owner</th>
                <th className="text-center">Stays</th>
                <th className="text-right">Credits</th>
                <th className="text-right">Maintenance</th>
                <th className="text-right">Net due</th>
              </tr>
            </thead>
            <tbody>
              {statements.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-gray-400 py-8">
                    No owner balances in this period
                  </td>
                </tr>
              ) : (
                statements.map((s) => (
                  <tr key={s.unit_id}>
                    <td>
                      <div className="font-medium">{s.unit_name}</div>
                      <div className="text-xs text-gray-500">{s.project}</div>
                    </td>
                    <td className="text-gray-600">{s.owner_names}</td>
                    <td className="text-center">{s.reservation_count}</td>
                    <td className="text-right tabular-nums">{currency(s.gross_credits)}</td>
                    <td className="text-right tabular-nums text-rose-600">
                      {s.maintenance_deductions > 0
                        ? `−${currency(s.maintenance_deductions)}`
                        : '—'}
                    </td>
                    <td className="text-right tabular-nums font-bold text-soul-blue">
                      {currency(s.net_payout_due)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">Withdrawal requests</div>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Owner</th>
                <th className="text-right">Amount</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-8">
                    No withdrawal requests
                  </td>
                </tr>
              ) : (
                payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.owner_name || p.owner_username}</td>
                    <td className="text-right tabular-nums">{currency(p.amount)}</td>
                    <td>
                      <span className="capitalize text-xs font-medium">{p.status}</span>
                    </td>
                    <td className="text-xs">{formatDate(p.created_at)}</td>
                    <td className="text-right space-x-2">
                      {p.status === 'requested' && (
                        <>
                          <button
                            type="button"
                            className="text-xs text-emerald-700"
                            onClick={() =>
                              reviewPayout.mutate({ id: p.id, status: 'approved' })
                            }
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="text-xs text-red-600"
                            onClick={() =>
                              reviewPayout.mutate({ id: p.id, status: 'rejected' })
                            }
                          >
                            Reject
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
                          Mark settled
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LedgerTab({ rangeParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-ledger', rangeParams],
    queryFn: () =>
      api.get('/financial-system/ledger', { params: rangeParams }).then((r) => r.data),
  });

  const grouped = useMemo(() => accountsByGroup(), []);

  if (isLoading) return <LoadingSpinner />;

  const journal = data?.journal || [];
  const balances = data?.account_balances || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="card p-0 overflow-hidden max-h-[480px] overflow-y-auto">
          <div className="px-6 py-4 border-b sticky top-0 bg-white z-10">
            <h3 className="font-semibold">Account directory</h3>
            <p className="text-xs text-gray-500">Soul chart of accounts</p>
          </div>
          {Object.entries(grouped).map(([group, { label, accounts }]) => (
            <div key={group} className="border-b last:border-0">
              <div className="px-6 py-2 bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-500">
                {label}
              </div>
              {accounts.map((a) => {
                const bal = balances.find((b) => b.name === a.name);
                return (
                  <div
                    key={a.code}
                    className="px-6 py-2.5 flex justify-between gap-3 text-sm hover:bg-gray-50"
                  >
                    <span className="text-gray-800">{a.name}</span>
                    {bal ? (
                      <span className="tabular-nums text-gray-700 font-medium shrink-0">
                        {currency(bal.balance)}
                      </span>
                    ) : (
                      <span className="text-gray-300 shrink-0">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="card p-0 overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h3 className="font-semibold">Balances this period</h3>
            <p className="text-xs text-gray-500">Accounts with activity only</p>
          </div>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="table text-sm">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th>Account</th>
                  <th className="text-right">In</th>
                  <th className="text-right">Out</th>
                  <th className="text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {balances.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center text-gray-400 py-8">
                      No ledger activity
                    </td>
                  </tr>
                ) : (
                  balances.map((b) => (
                    <tr key={b.code || b.name}>
                      <td className="font-medium text-gray-800">{b.name}</td>
                      <td className="text-right tabular-nums">{currency(b.debit)}</td>
                      <td className="text-right tabular-nums">{currency(b.credit)}</td>
                      <td className="text-right tabular-nums font-semibold">
                        {currency(b.balance)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h3 className="font-semibold">Transaction log</h3>
          <p className="text-xs text-gray-500">Bookings, expenses, and manual entries</p>
        </div>
        <div className="divide-y max-h-[520px] overflow-y-auto">
          {journal.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No entries yet</div>
          ) : (
            journal.slice(0, 100).map((entry) => (
              <div key={entry.id} className="px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div>
                    <span className="text-sm font-medium text-gray-900">{entry.description}</span>
                    <span className="text-gray-300 mx-2">·</span>
                    <span className="text-xs text-gray-400 capitalize">{entry.type}</span>
                  </div>
                  <span className="text-xs text-gray-500">{formatDate(entry.date)}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs">
                  {entry.lines.map((line, i) => (
                    <div
                      key={i}
                      className="flex justify-between gap-2 py-1.5 px-2.5 rounded-lg bg-gray-50"
                    >
                      <span className="text-gray-700 truncate">
                        {line.account_name || line.memo}
                      </span>
                      <span className="tabular-nums whitespace-nowrap text-gray-800 font-medium">
                        {line.debit > 0
                          ? `+${currency(line.debit)}`
                          : `−${currency(line.credit)}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ManualEntriesTab({ fromDate, toDate, rangeParams }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState(null);
  const [form, setForm] = useState({
    entry_type: 'revenue',
    description: '',
    amount: '',
    entry_date: new Date().toISOString().slice(0, 10),
    notes: '',
    unit_id: '',
  });

  const { data: units = [] } = useQuery({
    queryKey: ['financial-system-units'],
    queryFn: () => api.get('/financial-system/units').then((r) => r.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-manual', fromDate, toDate],
    queryFn: () =>
      api.get('/financial-system/manual-entries', { params: rangeParams }).then((r) => r.data),
  });

  const createEntry = useMutation({
    mutationFn: (payload) => api.post('/financial-system/manual-entries', payload),
    onSuccess: () => {
      toast.success('Entry added');
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-overview'] });
      qc.invalidateQueries({ queryKey: ['financial-system-ledger'] });
      setShowForm(false);
      setForm({
        entry_type: 'revenue',
        description: '',
        amount: '',
        entry_date: new Date().toISOString().slice(0, 10),
        notes: '',
        unit_id: '',
      });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to save entry'),
  });

  const removeEntry = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/manual-entries/${id}`),
    onSuccess: () => {
      toast.success('Entry removed');
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-overview'] });
      qc.invalidateQueries({ queryKey: ['financial-system-ledger'] });
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to delete'),
  });

  function handleSubmit(e) {
    e.preventDefault();
    const amount = parseFloat(form.amount);
    if (!(amount > 0)) {
      toast.error('Enter a valid amount');
      return;
    }
    if (!form.description.trim()) {
      toast.error('Description is required');
      return;
    }
    createEntry.mutate({
      entry_type: form.entry_type,
      description: form.description.trim(),
      amount,
      entry_date: form.entry_date,
      notes: form.notes.trim() || undefined,
      unit_id: form.unit_id || undefined,
    });
  }

  if (isLoading) return <LoadingSpinner />;

  const entries = data?.entries || [];
  const totals = data?.totals || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-gray-900">Manual revenue & expense</h3>
          <p className="text-xs text-gray-500 mt-1">
            One-off lines that are not tied to a booking — posted to the ledger automatically
          </p>
        </div>
        <button type="button" className="btn-primary text-sm" onClick={() => setShowForm(true)}>
          <Plus className="w-4 h-4" />
          Add entry
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['Custom revenue', totals.revenue, 'text-emerald-700'],
          ['Custom expense', totals.expense, 'text-rose-700'],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-gray-100 bg-white px-4 py-3">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">{label}</p>
            <p className={`text-sm font-bold tabular-nums mt-0.5 ${tone}`}>{currency(value || 0)}</p>
          </div>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Description</th>
                <th>Unit</th>
                <th className="text-right">Amount</th>
                <th>Added by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-gray-400 py-8">
                    No manual entries in this period
                  </td>
                </tr>
              ) : (
                entries.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap">{formatDate(row.entry_date)}</td>
                    <td>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          row.entry_type === 'revenue'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {ENTRY_TYPE_LABELS[row.entry_type] || row.entry_type}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium text-gray-900">{row.description}</div>
                      {row.notes ? (
                        <div className="text-xs text-gray-500 mt-0.5">{row.notes}</div>
                      ) : null}
                    </td>
                    <td className="text-xs text-gray-500">{row.unit_name || '—'}</td>
                    <td className="text-right tabular-nums font-semibold">{currency(row.amount)}</td>
                    <td className="text-xs text-gray-500">{row.created_by_name || '—'}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"
                        onClick={() => setDeleteId(row.id)}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add entry"
        size="md"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button
              type="submit"
              form="manual-entry-form"
              className="btn-primary"
              disabled={createEntry.isPending}
            >
              {createEntry.isPending ? 'Saving…' : 'Save entry'}
            </button>
          </>
        }
      >
        <form id="manual-entry-form" className="space-y-5" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <label className="label">Type</label>
              <select
                className="input w-full"
                value={form.entry_type}
                onChange={(e) => setForm((f) => ({ ...f, entry_type: e.target.value }))}
              >
                <option value="revenue">Custom revenue</option>
                <option value="expense">Custom expense</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="label">Description</label>
            <input
              className="input w-full"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What is this for?"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="label">Amount (EGP)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="input w-full"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="0.00"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="label">Date</label>
            <input
              type="date"
              className="input w-full"
              min={FINANCIAL_EPOCH}
              value={form.entry_date}
              onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="label">Unit (optional)</label>
            <SearchableSelect
              className="w-full"
              value={form.unit_id}
              onChange={(v) => setForm((f) => ({ ...f, unit_id: v }))}
              placeholder="Not linked to a unit"
              options={[
                { value: '', label: 'Not linked to a unit' },
                ...units.map((u) => ({
                  value: String(u.id),
                  label: `${u.project ? `${u.project} — ` : ''}${u.unit_name}`,
                })),
              ]}
            />
          </div>

          <div className="space-y-1.5">
            <label className="label">Notes (optional)</label>
            <textarea
              className="input w-full min-h-[88px] resize-y"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Internal notes"
              rows={3}
            />
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title="Delete manual entry?"
        message="This removes the line from the ledger for this period."
        confirmText="Delete"
        danger
        onConfirm={() => removeEntry.mutate(deleteId)}
        loading={removeEntry.isPending}
      />
    </div>
  );
}

function TaxTab({ rangeParams }) {
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-tax', rangeParams],
    queryFn: () =>
      api.get('/financial-system/tax', { params: rangeParams }).then((r) => r.data),
  });

  if (isLoading) return <LoadingSpinner />;

  const liability = data?.liability || {};
  const vat = liability.output_vat || {};
  const wht = liability.withholding || {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5 border-l-4 border-amber-500">
          <p className="text-xs uppercase tracking-wider text-gray-500">
            Output VAT ({VAT_OUTPUT_PCT}%)
          </p>
          <p className="text-2xl font-bold text-amber-800 mt-2 tabular-nums">
            {currency(vat.vat_amount)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            On commission base {currency(vat.taxable_base)}
          </p>
        </div>
        <div className="card p-5 border-l-4 border-violet-500">
          <p className="text-xs uppercase tracking-wider text-gray-500">Withholding tax</p>
          <p className="text-2xl font-bold text-violet-800 mt-2 tabular-nums">
            {currency(wht.total_wht)}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {WHT_STANDARD_PCT}% standard · {WHT_REDUCED_PCT}% professional services
          </p>
        </div>
        <div className="card p-5 border-l-4 border-soul-blue">
          <p className="text-xs uppercase tracking-wider text-gray-500">Total tax due</p>
          <p className="text-2xl font-bold text-soul-blue mt-2 tabular-nums">
            {currency(liability.total_tax_liability)}
          </p>
          <p className="text-xs text-gray-500 mt-1">{liability.month}</p>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">Withholding on expenses</div>
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Description</th>
                <th className="text-right">Amount</th>
                <th className="text-center">Rate</th>
                <th className="text-right">WHT</th>
              </tr>
            </thead>
            <tbody>
              {(wht.lines || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-gray-400 py-6">
                    No expenses in this period
                  </td>
                </tr>
              ) : (
                wht.lines.map((line, i) => (
                  <tr key={i}>
                    <td>{line.vendor}</td>
                    <td className="text-right tabular-nums">{currency(line.vendor_base)}</td>
                    <td className="text-center">{line.rate_pct}%</td>
                    <td className="text-right tabular-nums text-violet-700">
                      {currency(line.wht_amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const TAB_ALIASES = {
  overview: 'overview',
  profit: 'overview',
  finance: 'overview',
  splits: 'splits',
  bookings: 'splits',
  owners: 'owners',
  settlements: 'owners',
  statement: 'owners',
  ledger: 'ledger',
  accounts: 'ledger',
  manual: 'manual',
  expenses: 'manual',
  'petty-cash': 'ledger',
  tax: 'tax',
  reports: 'overview',
};

export default function FinancialSystem() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'overview';
  const activeTab = TAB_ALIASES[rawTab] || 'overview';

  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
  const [toDate, setToDate] = useState('');

  const rangeParams = {
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
  };

  function setTab(id) {
    setSearchParams({ tab: id }, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div className="page-header mb-0">
          <h1 className="page-title flex items-center gap-2">
            <Landmark className="w-7 h-7 text-soul-blue" />
            Financial System
          </h1>
          <p className="page-subtitle">
            Trust balances, booking splits, owner payouts, and Egyptian tax
          </p>
        </div>
        <DateFilters
          fromDate={fromDate}
          toDate={toDate}
          onFrom={setFromDate}
          onTo={setToDate}
        />
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-soul-blue shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'overview' && (
        <OverviewTab fromDate={fromDate} toDate={toDate} rangeParams={rangeParams} />
      )}
      {activeTab === 'splits' && <BookingSplitsTab rangeParams={rangeParams} />}
      {activeTab === 'owners' && (
        <OwnerStatementsTab
          fromDate={fromDate}
          toDate={toDate}
          rangeParams={rangeParams}
        />
      )}
      {activeTab === 'manual' && (
        <ManualEntriesTab fromDate={fromDate} toDate={toDate} rangeParams={rangeParams} />
      )}
      {activeTab === 'ledger' && <LedgerTab rangeParams={rangeParams} />}
      {activeTab === 'tax' && <TaxTab rangeParams={rangeParams} />}
    </div>
  );
}
