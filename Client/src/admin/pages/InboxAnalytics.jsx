import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, Clock, AlertTriangle, CheckCircle, TrendingUp, Users, DollarSign,
  Calendar, Filter, RefreshCw, Award, Zap, PieChart
} from 'lucide-react';
import { inboxApi } from '../inbox/api';
import { useInbox } from '../inbox/InboxContext';
import { fmtSeconds, fmtMoney, pct } from '../inbox/utils';

export default function InboxAnalyticsPage() {
  const { me } = useInbox();
  const [periodDays, setPeriodDays] = useState(7);
  const [selectedUser, setSelectedUser] = useState('');

  const now = Date.now();
  const from = now - periodDays * 86400000;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['inbox-analytics', periodDays, selectedUser],
    queryFn: () => inboxApi.get('/analytics', {
      from,
      to: now,
      user: selectedUser || undefined,
    }),
    refetchInterval: 30000,
  });

  const kpis = data?.kpis || {};
  const agents = data?.agents || [];
  const channels = data?.channels || {};
  const live = data?.live || {};

  return (
    <div className="pms-shell min-h-screen bg-slate-50 p-6 space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-soul-blue" />
            Inbox & SLA Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Track response speed, SLA compliance rates, agent productivity, and sales pipeline conversion metrics.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex items-center gap-3 text-xs">
          <select
            value={periodDays}
            onChange={(e) => setPeriodDays(Number(e.target.value))}
            className="p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 font-bold focus:outline-none"
          >
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>

          {me?.role === 'admin' || me?.role === 'manager' ? (
            <select
              value={selectedUser}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="p-2 border border-slate-200 rounded-xl bg-slate-50 text-slate-700 font-bold focus:outline-none"
            >
              <option value="">All Team Members</option>
              {(me?.users || []).map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          ) : null}

          <button
            type="button"
            onClick={() => refetch()}
            className="p-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 font-bold flex items-center gap-1"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-xs text-slate-400">Loading analytics indicators…</div>
      ) : (
        <>
          {/* Top Key Metrics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                <span>Avg First Response Time</span>
                <Clock className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-2xl font-black text-slate-900">
                {fmtSeconds(kpis.first_response_time?.avg)}
              </div>
              <div className="text-[11px] text-slate-500">
                Target: {me?.rules?.sla_target_min || 15}m · Median: {fmtSeconds(kpis.first_response_time?.median)}
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                <span>SLA Compliance Rate</span>
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-slate-900">
                {pct(kpis.sla_compliance_pct)}
              </div>
              <div className="text-[11px] text-slate-500">
                Breaches: <span className="text-rose-600 font-bold">{kpis.breach_count || 0}</span>
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                <span>Lead Conversion Rate</span>
                <TrendingUp className="w-4 h-4 text-purple-500" />
              </div>
              <div className="text-2xl font-black text-slate-900">
                {pct(kpis.lead_conversion_pct)}
              </div>
              <div className="text-[11px] text-slate-500">
                Won: <strong className="text-slate-800">{kpis.won_count || 0}</strong> / {kpis.total_leads || 0} total leads
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between text-xs font-medium text-slate-400">
                <span>Won Bookings Revenue</span>
                <DollarSign className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="text-2xl font-black text-emerald-600">
                {fmtMoney(kpis.won_value || 0)}
              </div>
              <div className="text-[11px] text-slate-500">
                Average deal: {fmtMoney(kpis.won_count ? kpis.won_value / kpis.won_count : 0)}
              </div>
            </div>
          </div>

          {/* Live Snapshot & Channel Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Live Operational Status */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" />
                Live Operational Snapshot
              </h2>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-slate-400 block">Open Chats</span>
                  <strong className="text-lg font-bold text-slate-800">{live.open || 0}</strong>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <span className="text-slate-400 block">Needs Reply</span>
                  <strong className="text-lg font-bold text-blue-600">{live.needs_reply || 0}</strong>
                </div>
                <div className="bg-rose-50 p-3 rounded-xl border border-rose-100">
                  <span className="text-rose-600 font-medium block">Overdue SLA</span>
                  <strong className="text-lg font-bold text-rose-700">{live.overdue || 0}</strong>
                </div>
                <div className="bg-amber-50 p-3 rounded-xl border border-amber-100">
                  <span className="text-amber-700 font-medium block">At Risk</span>
                  <strong className="text-lg font-bold text-amber-800">{live.at_risk || 0}</strong>
                </div>
              </div>
            </div>

            {/* Channel Traffic Breakdown */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm lg:col-span-2 space-y-4">
              <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-soul-blue" />
                Channel Breakdown (WhatsApp vs Instagram vs Messenger)
              </h2>
              <div className="grid grid-cols-3 gap-4 text-xs">
                {['whatsapp', 'instagram', 'messenger'].map((ch) => {
                  const data = channels[ch] || {};
                  return (
                    <div key={ch} className="p-3 bg-slate-50 rounded-xl border border-slate-200 capitalize space-y-1">
                      <div className="font-bold text-slate-800">{ch}</div>
                      <div className="text-slate-500 text-[11px]">Chats: <strong>{data.conversations || 0}</strong></div>
                      <div className="text-slate-500 text-[11px]">Leads: <strong>{data.leads || 0}</strong></div>
                      <div className="text-slate-500 text-[11px]">Won: <strong className="text-emerald-600">{data.won || 0}</strong></div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Team Leaderboard */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs space-y-3">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="font-bold text-sm text-slate-900 flex items-center gap-2">
                <Award className="w-4 h-4 text-amber-500" />
                Agent Performance Leaderboard
              </h2>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                  <th className="p-3">Agent</th>
                  <th className="p-3">Role</th>
                  <th className="p-3">Outbound Sent</th>
                  <th className="p-3">Avg First Response</th>
                  <th className="p-3">SLA Compliance</th>
                  <th className="p-3">Leads Handled</th>
                  <th className="p-3">Won Deals</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agents.map((ag) => (
                  <tr key={ag.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-3 font-bold text-slate-900">{ag.name}</td>
                    <td className="p-3 font-medium text-slate-500 capitalize">{ag.role || '—'}</td>
                    <td className="p-3 font-semibold text-slate-700">{ag.sent_count || 0}</td>
                    <td className="p-3 font-semibold text-slate-700">{fmtSeconds(ag.first_response_avg)}</td>
                    <td className="p-3 font-bold text-slate-900">{pct(ag.sla_compliance_pct)}</td>
                    <td className="p-3 font-medium text-slate-700">{ag.leads_count || 0}</td>
                    <td className="p-3 font-bold text-emerald-600">{ag.won_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
