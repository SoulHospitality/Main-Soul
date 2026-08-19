import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Wallet, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import SearchFilter from '../components/ui/SearchFilter';
import { ROLE_LABELS } from '../utils/permissions';
import { currency } from '../utils/formatters';

function currentPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function Payrolls() {
  const qc = useQueryClient();
  const initial = currentPeriod();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [search, setSearch] = useState('');
  const [payTarget, setPayTarget] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['hr-payroll', year, month],
    queryFn: () => api.get('/hr/payroll', { params: { year, month } }).then((r) => r.data),
  });

  const payMutation = useMutation({
    mutationFn: (payload) => api.post('/hr/payroll/mark-paid', payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hr-payroll'] });
      toast.success(`Marked ${res.data.count} salary payment${res.data.count === 1 ? '' : 's'}`);
      setPayTarget(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not mark paid'),
  });

  const staff = data?.staff || [];
  const totals = data?.totals || { base: 0, bonuses: 0, deductions: 0, net: 0, paid: 0, unpaid: 0 };
  const q = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      staff.filter((s) => {
        if (!q) return true;
        return [s.full_name, s.staff_code, s.role, ROLE_LABELS[s.role]]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      }),
    [staff, q]
  );
  const unpaidIds = staff.filter((s) => s.status !== 'paid').map((s) => s.staff_user_id);
  const years = Array.from({ length: 6 }, (_, i) => initial.year - 2 + i);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">HR</p>
          <h1 className="page-title mt-1">Payrolls</h1>
          <p className="page-subtitle">
            Track staff salaries, deductions, and money paid for each month.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((label, i) => (
              <option key={label} value={i + 1}>{label}</option>
            ))}
          </select>
          <select className="input w-auto" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn-primary"
            disabled={!unpaidIds.length || payMutation.isPending}
            onClick={() => setPayTarget({ all: true })}
          >
            <Wallet className="h-4 w-4" />
            Mark unpaid as paid
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Gross salaries', value: totals.base },
          { label: 'Bonuses', value: totals.bonuses },
          { label: 'Deductions', value: totals.deductions },
          { label: 'Net payroll', value: totals.net },
          { label: 'Still unpaid', value: totals.unpaid },
        ].map((card) => (
          <div key={card.label} className="card">
            <p className="text-[11px] uppercase tracking-wide text-soul-muted">{card.label}</p>
            <p className="mt-1 font-num text-lg font-semibold text-soul-blue">{currency(card.value)}</p>
          </div>
        ))}
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search staff…" />

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState icon={Wallet} title="No staff on payroll for this month" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Base salary</th>
                  <th>Bonuses</th>
                  <th>Deductions</th>
                  <th>Net pay</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.staff_user_id}>
                    <td>
                      <div className="font-semibold text-soul-blue">{s.full_name}</div>
                      <div className="text-[11px] text-soul-muted">
                        {s.staff_code ? `${s.staff_code} · ` : ''}
                        {ROLE_LABELS[s.role] || s.role}
                      </div>
                    </td>
                    <td className="tabular-nums whitespace-nowrap">{currency(s.base_salary)}</td>
                    <td className="tabular-nums whitespace-nowrap text-emerald-700">{currency(s.bonuses || 0)}</td>
                    <td className="tabular-nums whitespace-nowrap text-rose-700">{currency(s.deductions)}</td>
                    <td className="tabular-nums whitespace-nowrap font-semibold">{currency(s.net_pay)}</td>
                    <td>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                          s.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-800'
                        }`}
                      >
                        {s.status === 'paid' ? 'Paid' : 'Unpaid'}
                      </span>
                    </td>
                    <td>
                      {s.status !== 'paid' ? (
                        <button
                          type="button"
                          className="btn-secondary text-xs px-2 py-1"
                          onClick={() => setPayTarget({ staff: s })}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Mark paid
                        </button>
                      ) : (
                        <span className="text-[11px] text-soul-muted">
                          {s.paid_by_name ? `By ${s.paid_by_name}` : 'Recorded'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title="Record salary payment"
        confirmText="Mark paid"
        loading={payMutation.isPending}
        message={
          payTarget?.all
            ? `Record net pay for ${unpaidIds.length} unpaid staff in ${MONTHS[month - 1]} ${year}? This freezes the amounts for this month.`
            : `Record ${currency(payTarget?.staff?.net_pay)} paid to ${payTarget?.staff?.full_name} for ${MONTHS[month - 1]} ${year}?`
        }
        onConfirm={() =>
          payMutation.mutate({
            year,
            month,
            staff_user_ids: payTarget?.all ? unpaidIds : [payTarget.staff.staff_user_id],
          })
        }
      />
    </div>
  );
}
