import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Receipt } from 'lucide-react';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { ROLE_LABELS } from '../utils/permissions';
import { currency, formatDate } from '../utils/formatters';
import { DEDUCTION_TYPE_LABELS } from '../utils/hrPolicy';
import { useAuth } from '../context/AuthContext';

function currentPeriod() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function LineSection({ title, items, dateKey, empty, negative }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-soul-muted mb-2">{title}</h3>
      {!items.length ? (
        <p className="text-sm text-soul-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-soul-line">
          {items.map((row) => (
            <li key={row.id} className="flex items-start justify-between gap-3 py-2 text-sm">
              <div>
                <div className="text-soul-blue">
                  {DEDUCTION_TYPE_LABELS[row.category] || row.reason}
                </div>
                <div className="text-[11px] text-soul-muted">
                  {formatDate(row[dateKey])}
                  {row.reason && DEDUCTION_TYPE_LABELS[row.category] ? ` · ${row.reason}` : ''}
                  {row.arrival_time ? ` · arrived ${String(row.arrival_time).slice(0, 5)}` : ''}
                </div>
              </div>
              <span className={`tabular-nums whitespace-nowrap font-semibold ${negative ? 'text-rose-700' : 'text-emerald-700'}`}>
                {negative ? '−' : '+'}
                {currency(row.amount)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function Payslip() {
  const { user } = useAuth();
  const initial = currentPeriod();
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const years = Array.from({ length: 6 }, (_, i) => initial.year - 2 + i);

  const { data, isLoading } = useQuery({
    queryKey: ['hr-payslip', year, month],
    queryFn: () => api.get('/hr/payslip', { params: { year, month } }).then((r) => r.data),
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="page-header mb-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-soul-muted">Payroll</p>
          <h1 className="page-title mt-1">Payslip</h1>
          <p className="page-subtitle">Your base salary, bonuses, penalties, deductions, and net for the month.</p>
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
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : !data ? (
        <div className="card text-sm text-soul-muted">Could not load this payslip.</div>
      ) : (
        <div className="card space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                <Receipt className="w-5 h-5 text-soul-blue" />
              </div>
              <div>
                <div className="font-semibold text-soul-blue">{data.full_name || user?.full_name}</div>
                <div className="text-[11px] text-soul-muted">
                  {data.staff_code ? `${data.staff_code} · ` : ''}
                  {ROLE_LABELS[data.role] || data.role}
                  {' · '}
                  {MONTHS[month - 1]} {year}
                </div>
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                data.status === 'paid' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {data.status === 'paid' ? 'Paid' : 'Unpaid'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Base', value: data.base_salary, className: 'text-soul-blue' },
              { label: 'Bonuses', value: data.bonuses, className: 'text-emerald-700' },
              { label: 'Penalties', value: data.penalties, className: 'text-rose-700' },
              { label: 'Deductions', value: data.deductions, className: 'text-rose-700' },
            ].map((card) => (
              <div key={card.label} className="rounded-xl border border-soul-line px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-soul-muted">{card.label}</p>
                <p className={`font-num font-semibold ${card.className}`}>{currency(card.value)}</p>
              </div>
            ))}
          </div>

          <div className="rounded-xl bg-slate-50 border border-soul-line px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-soul-blue">Net pay</span>
            <span className="font-num text-xl font-bold text-soul-blue">{currency(data.net_pay)}</span>
          </div>

          <LineSection
            title="Bonuses"
            items={data.bonus_items || []}
            dateKey="bonus_date"
            empty="No bonuses this month"
          />
          <LineSection
            title="Penalties"
            items={data.penalty_items || []}
            dateKey="deduction_date"
            empty="No penalties this month"
            negative
          />
          <LineSection
            title="Deductions"
            items={data.deduction_items || []}
            dateKey="deduction_date"
            empty="No deductions this month"
            negative
          />

          {data.paid_at ? (
            <p className="text-[11px] text-soul-muted">Recorded as paid on {formatDate(data.paid_at)}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
