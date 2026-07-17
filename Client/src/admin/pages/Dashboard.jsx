import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Building2, CalendarDays, DollarSign, LogIn, LogOut,
  TrendingUp, AlertCircle, Clock, ChevronRight,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import Badge from '../components/ui/Badge';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import { currency, formatDate } from '../utils/formatters';
import { getRoleTheme } from '../utils/roleTheme';
import { PMS_LABELS } from '../utils/permissions';

// ── helpers ──────────────────────────────────────────────────────────────────
const PROJECT_COLORS = ['#283f5e', '#134e5e', '#F28C28', '#2a9d8f', '#6b8cae', '#16233a', '#e8913a'];

function pctColor(pct) {
  if (pct >= 80) return 'text-emerald-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-red-500';
}
function pctBg(pct) {
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

// ── small stat card ───────────────────────────────────────────────────────────
function StatCard({ icon: Icon, iconBg, iconColor, title, value, sub }) {
  return (
    <div className="card p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon className={`w-6 h-6 ${iconColor}`} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-soul-muted uppercase tracking-[0.14em] font-medium">{title}</p>
        <p className="text-2xl font-semibold text-soul-blue leading-tight font-num tracking-tight">{value}</p>
        {sub && <p className="text-xs text-soul-muted/80 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── today list card (check-ins / check-outs) ─────────────────────────────────
function TodayCard({ icon: Icon, iconBg, iconColor, title, count, rows, emptyText, rowColor }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
            <Icon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div>
            <p className="font-semibold text-gray-900 text-sm">{title}</p>
            <p className="text-xs text-gray-400">{count} today</p>
          </div>
        </div>
        <span className={`text-3xl font-bold ${count > 0 ? iconColor : 'text-gray-300'}`}>{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic">{emptyText}</p>
      ) : (
        <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
          {rows.map(r => (
            <div key={r.id} className={`flex items-center justify-between rounded-lg px-3 py-2 ${rowColor}`}>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{r.guest_name}</p>
                <p className="text-xs text-gray-500">{r.project || ''}</p>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <p className="text-sm font-semibold text-gray-700">{r.unit_name}</p>
                {r.unit_number && <p className="text-xs text-gray-400">#{r.unit_number}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── main ──────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const theme = getRoleTheme(user?.role);
  const { isAdmin } = usePermissions();
  const canSeeFinance = isAdmin;

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard/stats').then(r => r.data),
    refetchInterval: 60_000,
  });

  if (isLoading) return <LoadingSpinner />;
  if (error) return (
    <div className="flex flex-col items-center justify-center h-64 text-red-500 gap-2">
      <AlertCircle className="w-8 h-8" />
      <p className="font-medium">Failed to load dashboard</p>
      <p className="text-sm text-gray-400">{error.message}</p>
    </div>
  );

  const monthLabels = { '01':'Jan','02':'Feb','03':'Mar','04':'Apr','05':'May','06':'Jun','07':'Jul','08':'Aug','09':'Sep','10':'Oct','11':'Nov','12':'Dec' };
  const revenueChart = (data?.monthlyRevenue || []).map(m => ({
    name: monthLabels[m.month?.split('-')[1]] || m.month,
    revenue: m.revenue,
  }));

  const projectStats  = data?.projectStats  || [];
  const checkinsToday = data?.calendar?.checkinsToday  || [];
  const checkoutsToday= data?.calendar?.checkoutsToday || [];

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="page-header">
        <p className="soul-eyebrow mb-2" style={{ color: 'var(--pms-accent-text)' }}>
          {theme.eyebrow} · {PMS_LABELS[user?.role]}
        </p>
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Welcome back, {user?.full_name} —{' '}
          {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'long', year:'numeric' })}
        </p>
      </div>

      {/* ── Top stat cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          icon={Building2}   iconBg="bg-soul-blue-50"    iconColor="text-soul-blue"
          title="Total Units"
          value={data?.units?.total ?? '—'}
          sub={`${projectStats.length} project${projectStats.length !== 1 ? 's' : ''}`}
        />
        <StatCard
          icon={CalendarDays} iconBg="bg-orange-50" iconColor="text-orange-600"
          title="Total Reservations"
          value={data?.reservations?.total ?? '—'}
          sub="Across all projects"
        />
        <StatCard
          icon={LogIn}  iconBg="bg-teal-50"   iconColor="text-teal-700"
          title="Check-ins Today"
          value={data?.calendar?.checkinsCount ?? 0}
          sub={data?.calendar?.checkinsCount ? 'Guests arriving' : 'No arrivals today'}
        />
        <StatCard
          icon={LogOut} iconBg="bg-sky-50" iconColor="text-sky-700"
          title="Check-outs Today"
          value={data?.calendar?.checkoutsCount ?? 0}
          sub={data?.calendar?.checkoutsCount ? 'Guests departing' : 'No departures today'}
        />
      </div>

      {/* ── Finance cards (non op-manager) ── */}
      {canSeeFinance && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={DollarSign}  iconBg="bg-emerald-100" iconColor="text-emerald-600"
            title="Revenue This Month"
            value={currency(data?.finance?.monthRevenue)}
            sub={`${currency(data?.finance?.monthPaid)} collected`}
          />
          <StatCard
            icon={AlertCircle} iconBg="bg-red-100"     iconColor="text-red-500"
            title="Pending Payments"
            value={currency(data?.finance?.pendingPayments)}
            sub="Outstanding balance"
          />
          <StatCard
            icon={Clock}       iconBg="bg-amber-100"   iconColor="text-amber-600"
            title="Upcoming Check-ins"
            value={data?.calendar?.upcomingCheckins ?? 0}
            sub="Next 7 days"
          />
        </div>
      )}

      {/* ── Per-project stats table ── */}
      {projectStats.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h3 className="font-semibold text-gray-900">Reservations &amp; Occupancy by Project</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-5 py-3 text-left font-semibold">Project</th>
                  <th className="px-5 py-3 text-center font-semibold">Total Units</th>
                  <th className="px-5 py-3 text-center font-semibold">Total Reservations</th>
                  <th className="px-5 py-3 text-center font-semibold">Occupied Now</th>
                  <th className="px-5 py-3 text-left font-semibold w-56">Occupancy %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {projectStats.map((p, i) => (
                  <tr key={p.project} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PROJECT_COLORS[i % PROJECT_COLORS.length] }} />
                        {p.project}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-center font-semibold text-gray-700">{p.total_units}</td>
                    <td className="px-5 py-3 text-center text-gray-600">{p.total_reservations}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`font-semibold ${p.occupied_units > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                        {p.occupied_units}
                      </span>
                      <span className="text-gray-400 text-xs ml-1">/ {p.total_units}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pctBg(p.occupancy_pct)}`}
                            style={{ width: `${p.occupancy_pct}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold w-10 text-right ${pctColor(p.occupancy_pct)}`}>
                          {p.occupancy_pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals row */}
              {projectStats.length > 1 && (
                <tfoot>
                  <tr className="bg-gray-100 border-t-2 border-gray-200">
                    <td className="px-5 py-3 font-bold text-gray-700">Total</td>
                    <td className="px-5 py-3 text-center font-bold text-gray-800">
                      {projectStats.reduce((s, p) => s + p.total_units, 0)}
                    </td>
                    <td className="px-5 py-3 text-center font-bold text-gray-800">
                      {projectStats.reduce((s, p) => s + p.total_reservations, 0)}
                    </td>
                    <td className="px-5 py-3 text-center font-bold text-blue-600">
                      {projectStats.reduce((s, p) => s + p.occupied_units, 0)}
                    </td>
                    <td className="px-5 py-3">
                      {(() => {
                        const totalUnits = projectStats.reduce((s, p) => s + p.total_units, 0);
                        const totalOcc   = projectStats.reduce((s, p) => s + p.occupied_units, 0);
                        const pct = totalUnits > 0 ? Math.round((totalOcc / totalUnits) * 100) : 0;
                        return (
                          <div className="flex items-center gap-3">
                            <div className="flex-1 bg-gray-200 rounded-full h-2.5 overflow-hidden">
                              <div className={`h-full rounded-full ${pctBg(pct)}`} style={{ width: `${pct}%` }} />
                            </div>
                            <span className={`text-sm font-bold w-10 text-right ${pctColor(pct)}`}>{pct}%</span>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ── Today: check-ins + check-outs ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TodayCard
          icon={LogIn}   iconBg="bg-teal-100"   iconColor="text-teal-600"
          title="Check-ins Today"
          count={checkinsToday.length}
          rows={checkinsToday}
          emptyText="No check-ins today"
          rowColor="bg-teal-50"
        />
        <TodayCard
          icon={LogOut}  iconBg="bg-orange-100" iconColor="text-orange-600"
          title="Check-outs Today"
          count={checkoutsToday.length}
          rows={checkoutsToday}
          emptyText="No check-outs today"
          rowColor="bg-orange-50"
        />
      </div>

      {/* ── Revenue chart (non op-manager) ── */}
      {canSeeFinance && revenueChart.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Revenue — Last 6 Months</h3>
            <TrendingUp className="w-4 h-4 text-gray-400" />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={revenueChart}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={v => [currency(v), 'Revenue']} />
              <Area type="monotone" dataKey="revenue" stroke="#3b82f6" strokeWidth={2}
                fill="url(#revGrad)" name="Revenue" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Recent reservations ── */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">Recent Reservations</h3>
          <Link to="/admin/reservations" className="text-sm text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1">
            View all <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {(data?.recentReservations || []).length > 0 ? (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Guest</th>
                  <th>Unit</th>
                  <th>Check-in</th>
                  <th>Check-out</th>
                  {canSeeFinance && <th>Amount</th>}
                  <th>Payment</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentReservations.map(r => (
                  <tr key={r.id}>
                    <td className="text-gray-400">#{r.id}</td>
                    <td className="font-medium">{r.guest_name}</td>
                    <td>{r.unit_name}</td>
                    <td>{formatDate(r.check_in)}</td>
                    <td>{formatDate(r.check_out)}</td>
                    {canSeeFinance && <td>{currency(r.total_amount)}</td>}
                    <td><Badge status={r.payment_status} /></td>
                    <td><Badge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-center text-gray-400 py-8 text-sm">No recent reservations</p>
        )}
      </div>
    </div>
  );
}
