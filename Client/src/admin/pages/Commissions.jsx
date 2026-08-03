import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeDollarSign, Download, TrendingUp, Users, Wallet, DollarSign, Globe, ClipboardList, Layers,
} from 'lucide-react';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SortTh from '../components/ui/SortTh';
import { currency, formatDate } from '../utils/formatters';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import * as XLSX from 'xlsx';

const normDate = (d) => String(d).split('T')[0];

export default function Commissions() {
  const { isAdmin, isReservations } = usePermissions();
  const agentOnly = isReservations && !isAdmin;
  const [fromDate, setFromDate] = useState(FINANCIAL_EPOCH);
  const [toDate, setToDate] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['commissions-breakdown', fromDate, toDate, agentOnly],
    queryFn: () =>
      api
        .get('/commissions/breakdown', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
  });

  const { data: finance } = useQuery({
    queryKey: ['finance-summary', fromDate, toDate],
    queryFn: () =>
      api
        .get('/finance/summary', {
          params: { from_date: fromDate || undefined, to_date: toDate || undefined },
        })
        .then((r) => r.data),
    enabled: isAdmin,
  });

  const { data: agentRows = [] } = useQuery({
    queryKey: ['staff-commissions'],
    queryFn: () => api.get('/commissions').then((r) => r.data),
    enabled: isAdmin,
  });

  const rows = data?.breakdown || [];
  const totals = data?.totals || {};
  const emptyChannel = { reservation_count: 0, revenue: 0, profit: 0, agent_commission: 0 };
  const channels = data?.channels || {
    all: emptyChannel,
    manual: emptyChannel,
    website: emptyChannel,
  };
  const website = channels.website || data?.website || emptyChannel;
  const manual = channels.manual || emptyChannel;
  const allChannel = channels.all || emptyChannel;
  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(rows, 'check_in', 'desc');

  const myCommission =
    totals.myCommission ??
    totals.agentCommissions ??
    (manual.agent_commission || 0) + (website.agent_commission || 0);

  const exportExcel = () => {
    if (!rows.length) return;
    const ws = XLSX.utils.json_to_sheet(
      rows.map((r) => ({
        Unit: r.unit_name,
        Project: r.project,
        Guest: r.guest_name,
        Agent: r.sales_person_name || '',
        'Agent %': r.agent_commission_pct ?? '',
        'Agent Commission': r.agent_commission ?? 0,
        'Check-in': normDate(r.check_in),
        'Check-out': normDate(r.check_out),
        Nights: r.nights,
        Type: r.is_owner ? 'Owner' : 'Regular',
        Channel: r.from_website ? 'Website' : 'Manual',
        Gross: r.gross,
        'Tenant Commission': r.tenant_deduction,
        Utilities: r.utilities,
        'Company Commission': r.company_commission,
        'Owner Net': r.owner_net,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Revenue Breakdown');
    XLSX.writeFile(wb, 'company_revenue.xlsx');
  };

  const totalOwnerNet =
    finance?.ownerOwed ??
    (totals.totalGross || 0) -
      (totals.totalCompany || 0) -
      (totals.totalTenant || 0) -
      (totals.totalUtilities || 0);
  const agentTotal =
    finance?.agentCommissions ??
    totals.agentCommissions ??
    (manual.agent_commission || 0) + (website.agent_commission || 0);
  const commissionProfit =
    finance?.commissionProfit ?? (totals.totalCompany || 0) - agentTotal;

  const SUMMARY_CARDS = agentOnly
    ? [
        {
          label: 'My commission',
          value: myCommission,
          icon: BadgeDollarSign,
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          iconBg: 'bg-amber-100',
          iconClr: 'text-amber-600',
          valClr: 'text-amber-800',
          lblClr: 'text-amber-700',
          subtitle: 'Your % of company commission on your reservations',
        },
        {
          label: 'My reservations',
          value: allChannel.reservation_count ?? rows.length,
          icon: ClipboardList,
          bg: 'bg-slate-50',
          border: 'border-slate-200',
          iconBg: 'bg-slate-100',
          iconClr: 'text-slate-600',
          valClr: 'text-slate-800',
          lblClr: 'text-slate-700',
          subtitle: 'In selected date range',
          format: 'count',
        },
        {
          label: 'Revenue handled',
          value: allChannel.revenue ?? totals.totalGross ?? 0,
          icon: Wallet,
          bg: 'bg-emerald-50',
          border: 'border-emerald-200',
          iconBg: 'bg-emerald-100',
          iconClr: 'text-emerald-600',
          valClr: 'text-emerald-800',
          lblClr: 'text-emerald-700',
          subtitle: 'Gross on your reservations',
        },
      ]
    : [
    {
      label: 'Company Commission',
      value: finance?.companyCommission ?? totals.regularCommission ?? totals.totalCompany ?? 0,
      icon: BadgeDollarSign,
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      iconBg: 'bg-yellow-100',
      iconClr: 'text-yellow-600',
      valClr: 'text-yellow-800',
      lblClr: 'text-yellow-700',
      subtitle: 'Base for agent commission %',
    },
    {
      label: 'Owner Share',
      value: totalOwnerNet,
      icon: Wallet,
      bg: 'bg-emerald-50',
      border: 'border-emerald-300',
      iconBg: 'bg-emerald-100',
      iconClr: 'text-emerald-600',
      valClr: 'text-emerald-800',
      lblClr: 'text-emerald-700',
      subtitle: 'Net amount due to owners',
    },
    {
      label: 'Manual agents',
      value: finance?.manualAgentCommission ?? manual.agent_commission ?? 0,
      icon: Users,
      bg: 'bg-violet-50',
      border: 'border-violet-200',
      iconBg: 'bg-violet-100',
      iconClr: 'text-violet-600',
      valClr: 'text-violet-800',
      lblClr: 'text-violet-700',
      subtitle: 'Per-agent % on manual bookings',
    },
    {
      label: 'Website agents',
      value: finance?.websiteAgentCommission ?? website.agent_commission ?? 0,
      icon: Users,
      bg: 'bg-sky-50',
      border: 'border-sky-200',
      iconBg: 'bg-sky-100',
      iconClr: 'text-sky-600',
      valClr: 'text-sky-800',
      lblClr: 'text-sky-700',
      subtitle: 'Per-agent % on website bookings',
    },
    {
      label: 'All agent commissions',
      value: agentTotal,
      icon: Globe,
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      iconBg: 'bg-amber-100',
      iconClr: 'text-amber-600',
      valClr: 'text-amber-800',
      lblClr: 'text-amber-700',
      subtitle: 'Manual + website agents',
    },
    {
      label: 'Commission Profit',
      value: commissionProfit,
      icon: TrendingUp,
      bg: 'bg-gradient-to-r from-primary-50 to-blue-50',
      border: 'border-primary-200',
      iconBg: 'bg-primary-100',
      iconClr: 'text-primary-600',
      valClr: 'text-primary-800',
      lblClr: 'text-primary-700',
      subtitle: 'Company − agent commissions',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="page-header mb-0">
          <h1 className="page-title">{agentOnly ? 'My Profit' : 'Commissions'}</h1>
          <p className="page-subtitle">
            {agentOnly
              ? 'Commission earned on reservations assigned to you'
              : 'Agent commission % is set per user — applied to company commission on their reservations'}
          </p>
        </div>
        {isAdmin && (
          <button onClick={exportExcel} className="btn-secondary">
            <Download className="w-4 h-4" />
            Export Excel
          </button>
        )}
      </div>

      <div className="card p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="label text-xs">From Date</label>
          <input
            type="date"
            className="input w-40"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label text-xs">To Date</label>
          <input
            type="date"
            className="input w-40"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
        {(fromDate || toDate) && (
          <button
            className="btn-secondary text-sm"
            onClick={() => {
              setFromDate(FINANCIAL_EPOCH);
              setToDate('');
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Channel split: all / manual / website (admin only) */}
      {!agentOnly && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card border border-slate-200 bg-slate-50/80 p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-200/80">
              <Layers className="h-4 w-4 text-slate-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">All reservations</h2>
              <p className="text-xs text-slate-500">Website + manual combined</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-medium text-slate-500">Reservations</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-slate-900">
                {allChannel.reservation_count ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-medium text-slate-500">Revenue</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {currency(allChannel.revenue ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-medium text-slate-500">Profit</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">
                {currency(allChannel.profit ?? 0)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">Company commission</p>
            </div>
          </div>
        </div>

        <div className="card border border-violet-200 bg-violet-50/50 p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100">
              <ClipboardList className="h-4 w-4 text-violet-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-violet-950">Manual reservations</h2>
              <p className="text-xs text-violet-700/80">Created in PMS (not guest website)</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-violet-100 bg-white/90 px-4 py-3">
              <p className="text-xs font-medium text-violet-700">Reservations</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-violet-950">
                {manual.reservation_count ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-white/90 px-4 py-3">
              <p className="text-xs font-medium text-violet-700">Revenue</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-violet-950">
                {currency(manual.revenue ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-white/90 px-4 py-3">
              <p className="text-xs font-medium text-violet-700">Profit</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-violet-950">
                {currency(manual.profit ?? 0)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">Company commission</p>
            </div>
            <div className="rounded-xl border border-violet-200 bg-violet-100/60 px-4 py-3">
              <p className="text-xs font-semibold text-violet-800">Agent commission</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-violet-950">
                {currency(manual.agent_commission ?? finance?.manualAgentCommission ?? 0)}
              </p>
              <p className="mt-0.5 text-[11px] text-violet-700/80">Per-agent % of company commission</p>
            </div>
          </div>
        </div>

        <div className="card border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100">
              <Globe className="h-4 w-4 text-sky-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-sky-950">Website reservations</h2>
              <p className="text-xs text-sky-700/80">Guest-site bookings only</p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="rounded-xl border border-sky-100 bg-white/80 px-4 py-3">
              <p className="text-xs font-medium text-sky-700">Reservations</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-sky-950">
                {website.reservation_count ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white/80 px-4 py-3">
              <p className="text-xs font-medium text-sky-700">Revenue</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-sky-950">
                {currency(website.revenue ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-sky-100 bg-white/80 px-4 py-3">
              <p className="text-xs font-medium text-sky-700">Profit</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-sky-950">
                {currency(website.profit ?? 0)}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">Company commission</p>
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50/90 px-4 py-3">
              <p className="text-xs font-semibold text-sky-800">Agent commission</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-sky-950">
                {currency(website.agent_commission ?? finance?.websiteAgentCommission ?? 0)}
              </p>
              <p className="mt-0.5 text-[11px] text-sky-700/80">Per-agent % of company commission</p>
            </div>
          </div>
        </div>
      </div>
      )}

      <div className={`grid gap-4 ${agentOnly ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-6'}`}>
        {SUMMARY_CARDS.map(
          ({ label, value, icon: Icon, bg, border, iconBg, iconClr, valClr, lblClr, subtitle, format }) => (
            <div key={label} className={`card p-4 ${bg} ${border}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-8 h-8 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${iconClr}`} />
                </div>
                <p className={`text-xs font-medium leading-tight ${lblClr}`}>{label}</p>
              </div>
              <p className={`text-lg font-bold tabular-nums ${valClr}`}>
                {format === 'count' ? value : currency(value)}
              </p>
              {subtitle && <p className="text-xs text-gray-400 mt-1 leading-tight">{subtitle}</p>}
            </div>
          )
        )}
      </div>

      {isAdmin && agentRows.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <div className="px-4 py-3 font-semibold border-b text-sm">Reservation agent commissions</div>
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Type</th>
                <th className="text-right">%</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {agentRows.slice(0, 50).map((c) => (
                <tr key={c.id}>
                  <td>{c.full_name}</td>
                  <td className="capitalize">{String(c.commission_type || '').replace(/_/g, ' ')}</td>
                  <td className="text-right tabular-nums">{c.percentage}%</td>
                  <td className="text-right tabular-nums font-semibold">{currency(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No reservations found"
          subtitle="Adjust your date filters to see commission breakdown"
        />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <SortTh col="unit_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Unit
                </SortTh>
                <SortTh col="guest_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Guest
                </SortTh>
                <SortTh col="check_in" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Check-in
                </SortTh>
                <SortTh col="check_out" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                  Check-out
                </SortTh>
                <SortTh
                  col="nights"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-center"
                >
                  Nights
                </SortTh>
                <th className="text-center">Type</th>
                <SortTh
                  col="gross"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                >
                  Gross
                </SortTh>
                <SortTh
                  col="tenant_deduction"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                >
                  Tenant Comm.
                </SortTh>
                <SortTh
                  col="utilities"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                >
                  Utilities
                </SortTh>
                <SortTh
                  col="company_commission"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  className="text-right"
                >
                  Company Comm.
                </SortTh>
                {agentOnly ? (
                  <SortTh
                    col="agent_commission"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  >
                    My Commission
                  </SortTh>
                ) : (
                  <SortTh
                    col="owner_net"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                    className="text-right"
                  >
                    Owner Net
                  </SortTh>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
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
                    {r.is_owner ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                        Owner
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                        Regular
                      </span>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-gray-900 font-medium">
                    {currency(r.gross)}
                  </td>
                  <td className="text-right tabular-nums text-blue-700">
                    {r.tenant_deduction > 0 ? (
                      currency(r.tenant_deduction)
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="text-right tabular-nums text-green-700">
                    {r.utilities > 0 ? currency(r.utilities) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="text-right tabular-nums text-yellow-700 font-semibold">
                    {r.company_commission > 0 ? (
                      currency(r.company_commission)
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  {agentOnly ? (
                    <td className="text-right tabular-nums text-amber-700 font-bold">
                      {currency(r.agent_commission || 0)}
                      {r.agent_commission_pct != null ? (
                        <div className="text-[10px] font-normal text-gray-400">{r.agent_commission_pct}%</div>
                      ) : null}
                    </td>
                  ) : (
                    <td className="text-right tabular-nums text-gray-700">{currency(r.owner_net)}</td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold text-sm">
                <td colSpan={6} className="text-right text-gray-600 pr-4">
                  Totals
                </td>
                <td className="text-right tabular-nums text-gray-900">{currency(totals.totalGross)}</td>
                <td className="text-right tabular-nums text-blue-700">{currency(totals.totalTenant)}</td>
                <td className="text-right tabular-nums text-green-700">
                  {currency(totals.totalUtilities)}
                </td>
                <td className="text-right tabular-nums text-yellow-700">
                  {currency(totals.totalCompany)}
                </td>
                <td className="text-right tabular-nums text-amber-800">
                  {agentOnly ? currency(myCommission) : currency(totalOwnerNet)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
