import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, Download } from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SearchableSelect from '../components/ui/SearchableSelect';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate, PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../utils/formatters';
import * as XLSX from 'xlsx';

export default function Payments() {
  const { isAdmin } = usePermissions();
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments-all', method, fromDate, toDate],
    queryFn: () => api.get('/payments/all', { params: {
      payment_method: method || undefined,
      from_date: fromDate || undefined,
      to_date: toDate || undefined,
    }}).then(r => r.data),
  });

  const filtered = payments.filter(p =>
    !search ||
    p.guest_name?.toLowerCase().includes(search.toLowerCase()) ||
    p.unit_name?.toLowerCase().includes(search.toLowerCase())
  );

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(filtered, 'payment_date', 'desc');

  const cancelledPayments = filtered.filter(p => p.cancel_note);

  // 'not_refundable' counts in total (company keeps the money).
  // 'refunded' is excluded (money returned to guest).
  const total = filtered
    .filter(p => p.cancel_note !== 'refunded')
    .reduce((s, p) => s + parseFloat(p.amount), 0);

  const exportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered.map(p => ({
      'Date':      p.payment_date,
      'Guest':     p.guest_name,
      'Unit':      p.unit_name,
      'Method':    PAYMENT_METHOD_LABELS[p.payment_method],
      'Amount':    p.cancel_note ? 0 : p.amount,
      'Status':    p.cancel_note === 'refunded' ? 'Refunded' : p.cancel_note === 'not_refundable' ? 'Not Refundable' : 'Active',
      'Reference': p.reference_number || '',
      'Notes':     p.notes || '',
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Payments');
    XLSX.writeFile(wb, 'payments.xlsx');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Payments</h1>
          <p className="page-subtitle">All received payments</p>
        </div>
        {(isAdmin) && <button onClick={exportExcel} className="btn-secondary"><Download className="w-4 h-4" />Export Excel</button>}
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search guest, unit...">
        <SearchableSelect className="w-44" value={method} onChange={setMethod}
          placeholder="All Methods"
          options={[{ value: '', label: 'All Methods' }, ...PAYMENT_METHODS.map(m => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))]}
        />
        <input type="date" className="input w-40" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        <input type="date" className="input w-40" value={toDate}   onChange={e => setToDate(e.target.value)} />
      </SearchFilter>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{filtered.length}</div>
          <div className="text-sm text-gray-500">Total Payments</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{currency(total)}</div>
          <div className="text-sm text-gray-500">Total Collected</div>
        </div>
        {cancelledPayments.filter(p => p.cancel_note === 'refunded').length > 0 && (
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold text-red-500">
              {cancelledPayments.filter(p => p.cancel_note === 'refunded').length}
            </div>
            <div className="text-sm text-gray-500">Refunded</div>
          </div>
        )}
        {cancelledPayments.filter(p => p.cancel_note === 'not_refundable').length > 0 && (
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold text-gray-500">
              {cancelledPayments.filter(p => p.cancel_note === 'not_refundable').length}
            </div>
            <div className="text-sm text-gray-500">Not Refundable</div>
          </div>
        )}
      </div>

      {isLoading ? <LoadingSpinner /> : filtered.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payments found" />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <SortTh col="payment_date" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Date</SortTh>
                  <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Guest</SortTh>
                  <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Unit</SortTh>
                  <SortTh col="payment_method" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Method</SortTh>
                  <SortTh col="reference_number" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Reference</SortTh>
                  <SortTh col="amount" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right">Amount</SortTh>
                  <th>Status</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(p => {
                  const isRefunded      = p.cancel_note === 'refunded';
                  const isNotRefundable = p.cancel_note === 'not_refundable';
                  // Strikethrough class for non-amount columns
                  const strike = (isRefunded || isNotRefundable) ? 'line-through text-gray-400' : '';
                  return (
                    <tr key={p.id} className={(isRefunded || isNotRefundable) ? 'bg-red-50 opacity-80' : ''}>
                      <td className={`text-xs ${strike || 'text-gray-400'}`}>#{p.id}</td>
                      <td className={strike}>{formatDate(p.payment_date)}</td>
                      <td className={`font-medium ${strike}`}>{p.guest_name}</td>
                      <td className={strike}>{p.unit_name}</td>
                      <td>
                        <span className={`badge-blue ${(isRefunded || isNotRefundable) ? 'opacity-50' : ''}`}>
                          {PAYMENT_METHOD_LABELS[p.payment_method]}
                        </span>
                      </td>
                      <td className={strike || 'text-gray-400'}>{p.reference_number || '—'}</td>
                      <td className="text-right">
                        {/* Refunded: strikethrough amount (excluded from total) */}
                        {isRefunded && <span className="line-through text-gray-400">{currency(p.amount)}</span>}
                        {/* Not Refundable: normal amount (counts in total) */}
                        {isNotRefundable && <span className="font-semibold text-gray-900">{currency(p.amount)}</span>}
                        {/* Active */}
                        {!isRefunded && !isNotRefundable && <span className="font-semibold text-gray-900">{currency(p.amount)}</span>}
                      </td>
                      <td>
                        {isRefunded && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                            ↩ Refunded
                          </span>
                        )}
                        {isNotRefundable && (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                            ✕ Not Refundable
                          </span>
                        )}
                      </td>
                      <td className={`text-xs ${strike || 'text-gray-400'}`}>{p.created_by_name}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 font-semibold">
                  <td colSpan={6} className="px-4 py-3 text-right text-gray-700">Total</td>
                  <td className="px-4 py-3 text-gray-900 text-right">{currency(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
