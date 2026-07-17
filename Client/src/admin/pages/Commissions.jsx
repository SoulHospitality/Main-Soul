import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeDollarSign, Download, TrendingUp, Users, Zap, Home, DollarSign, Wallet,
} from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate } from '../utils/formatters';
import * as XLSX from 'xlsx';

const normDate = d => String(d).split('T')[0];

export default function Commissions() {
  const { isAdmin } = usePermissions();
  const [fromDate, setFromDate] = useState('');
  const [toDate,   setToDate]   = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['commissions-breakdown', fromDate, toDate],
    queryFn: () => api.get('/commissions/breakdown', {
      params: { from_date: fromDate || undefined, to_date: toDate || undefined },
    }).then(r => r.data),
  });

  const rows   = data?.breakdown || [];
  const totals = data?.totals    || {};

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(rows, 'check_in', 'desc');

  const exportExcel = () => {
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows.map(r => ({
      'Unit':               r.unit_name,
      'Project':            r.project,
      'Guest':              r.guest_name,
      'Check-in':           normDate(r.check_in),
      'Check-out':          normDate(r.check_out),
      'Nights':             r.nights,
      'Type':               r.is_owner ? 'Owner' : 'Regular',
      'Gross':              r.gross,
      'Tenant Commission':  r.tenant_deduction,
      'Utilities':          r.utilities,
      'Company Commission': r.company_commission,
      'Owner Net':          r.owner_net,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue Breakdown');
    XLSX.writeFile(wb, 'company_revenue.xlsx');
  };

  const totalOwnerNet = ((totals.totalGross || 0) - (totals.totalCompany || 0) - (totals.totalTenant || 0) - (totals.totalUtilities || 0));

  const SUMMARY_CARDS = [
    {
      label:   'Company Commission',
      value:   totals.regularCommission || 0,
      icon:    BadgeDollarSign,
      bg:      'bg-yellow-50',
      border:  'border-yellow-200',
      iconBg:  'bg-yellow-100',
      iconClr: 'text-yellow-600',
      valClr:  'text-yellow-800',
      lblClr:  'text-yellow-700',
    },
    {
      label:   'Tenant Commission',
      value:   totals.totalTenant    || 0,
      icon:    Users,
      bg:      'bg-blue-50',
      border:  'border-blue-200',
      iconBg:  'bg-blue-100',
      iconClr: 'text-blue-600',
      valClr:  'text-blue-800',
      lblClr:  'text-blue-700',
    },
    {
      label:   'Utilities (see Utilities page)',
      value:   totals.totalUtilities || 0,
      icon:    Zap,
      bg:      'bg-green-50',
      border:  'border-green-200',
      iconBg:  'bg-green-100',
      iconClr: 'text-green-600',
      valClr:  'text-green-800',
      lblClr:  'text-green-700',
    },
    {
      label:   'Owner Reservation Commission',
      value:   totals.ownerRevenue   || 0,
      icon:    Home,
      bg:      'bg-purple-50',
      border:  'border-purple-200',
      iconBg:  'bg-purple-100',
      iconClr: 'text-purple-600',
      valClr:  'text-purple-800',
      lblClr:  'text-purple-700',
    },
    {
      label:   'Grand Total Commission',
      value:   totals.grandTotal     || 0,
      icon:    TrendingUp,
      bg:      'bg-gradient-to-r from-primary-50 to-blue-50',
      border:  'border-primary-200',
      iconBg:  'bg-primary-100',
      iconClr: 'text-primary-600',
      valClr:  'text-primary-800',
      lblClr:  'text-primary-700',
    },
    {
      label:   'Total Due to Owners',
      value:   totalOwnerNet,
      icon:    Wallet,
      bg:      'bg-emerald-50',
      border:  'border-emerald-300',
      iconBg:  'bg-emerald-100',
      iconClr: 'text-emerald-600',
      valClr:  'text-emerald-800',
      lblClr:  'text-emerald-700',
      subtitle: 'Gross − Commission − Tenant − Utilities',
    },
  ];

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title">Company Revenue</h1>
          <p className="page-subtitle">Breakdown of all company income per reservation</p>
        </div>
        {(isAdmin) && (
          <button onClick={exportExcel} className="btn-secondary">
            <Download className="w-4 h-4" />Export Excel
          </button>
        )}
      </div>

      {/* ── Date Filters ── */}
      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-xs">From Date</label>
          <input type="date" className="input w-40" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="label text-xs">To Date</label>
          <input type="date" className="input w-40" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        {(fromDate || toDate) && (
          <button className="btn-secondary text-sm" onClick={() => { setFromDate(''); setToDate(''); }}>
            Clear
          </button>
        )}
      </div>

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {SUMMARY_CARDS.map(({ label, value, icon: Icon, bg, border, iconBg, iconClr, valClr, lblClr, subtitle }) => (
          <div key={label} className={`card p-4 ${bg} ${border}`}>
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                <Icon className={`w-4 h-4 ${iconClr}`} />
              </div>
              <p className={`text-xs font-medium leading-tight ${lblClr}`}>{label}</p>
            </div>
            <p className={`text-lg font-bold tabular-nums ${valClr}`}>{currency(value)}</p>
            {subtitle && <p className="text-xs text-gray-400 mt-1 leading-tight">{subtitle}</p>}
          </div>
        ))}
      </div>

      {/* ── Per-Reservation Table ── */}
      {isLoading ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No reservations found"
          subtitle="Adjust your date filters to see company revenue"
        />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Unit</SortTh>
                <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Guest</SortTh>
                <SortTh col="check_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Check-in</SortTh>
                <SortTh col="check_out" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>Check-out</SortTh>
                <SortTh col="nights" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-center">Nights</SortTh>
                <th className="text-center">Type</th>
                <SortTh col="gross" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right">Gross</SortTh>
                <SortTh col="tenant_deduction" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right">Tenant Comm.</SortTh>
                <SortTh col="utilities" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right">Utilities</SortTh>
                <SortTh col="company_commission" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right">Company Comm.</SortTh>
                <SortTh col="owner_net" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="text-right">Owner Net</SortTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map(r => (
                <tr key={r.id}>
                  <td>
                    <div className="font-medium text-gray-900">{r.unit_name}</div>
                    {r.project && <div className="text-xs text-gray-400">{r.project}</div>}
                  </td>
                  <td className="text-gray-800">{r.guest_name}</td>
                  <td className="whitespace-nowrap text-gray-500">{formatDate(r.check_in)}</td>
                  <td className="whitespace-nowrap text-gray-500">{formatDate(r.check_out)}</td>
                  <td className="text-center text-gray-600">{r.nights}</td>
                  <td className="text-center">
                    {r.is_owner
                      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">Owner</span>
                      : <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Regular</span>
                    }
                  </td>
                  <td className="text-right tabular-nums text-gray-900 font-medium">{currency(r.gross)}</td>
                  <td className="text-right tabular-nums text-blue-700">
                    {r.tenant_deduction > 0 ? currency(r.tenant_deduction) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right tabular-nums text-green-700">
                    {r.utilities > 0 ? currency(r.utilities) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right tabular-nums text-yellow-700 font-semibold">
                    {r.company_commission > 0 ? currency(r.company_commission) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right tabular-nums text-gray-700">{currency(r.owner_net)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={6} className="text-right text-gray-600 pr-4">Totals</td>
                <td className="text-right tabular-nums text-gray-900">{currency(totals.totalGross)}</td>
                <td className="text-right tabular-nums text-blue-700">{currency(totals.totalTenant)}</td>
                <td className="text-right tabular-nums text-green-700">{currency(totals.totalUtilities)}</td>
                <td className="text-right tabular-nums text-yellow-700">{currency(totals.totalCompany)}</td>
                <td className="text-right tabular-nums text-gray-700">{currency(totals.totalGross - totals.totalCompany - totals.totalTenant - totals.totalUtilities)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
