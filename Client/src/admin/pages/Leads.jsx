import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Users, Search, Filter, Plus, Calendar, DollarSign, ArrowRight,
  CheckCircle2, XCircle, Clock, ChevronRight, MessageSquare, LayoutGrid, List
} from 'lucide-react';
import { inboxApi } from '../inbox/api';
import { useInbox } from '../inbox/InboxContext';
import { fmtDate, fmtMoney, timeAgo, stageTone } from '../inbox/utils';
import { Chip, StageChip } from '../inbox/ui';
import LeadPanel from '../inbox/LeadPanel';

export default function LeadsPage() {
  const { me } = useInbox();
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban' | 'table'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOwner, setSelectedOwner] = useState('');
  const [selectedStage, setSelectedStage] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  const stages = me?.stages || [
    { key: 'new', name_en: 'New Lead', kind: 'open' },
    { key: 'contacted', name_en: 'Contacted', kind: 'open' },
    { key: 'qualified', name_en: 'Qualified', kind: 'open' },
    { key: 'proposal', name_en: 'Proposal Sent', kind: 'open' },
    { key: 'won', name_en: 'Reserved (Won)', kind: 'won' },
    { key: 'lost', name_en: 'Lost', kind: 'lost' },
  ];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['inbox-leads', selectedOwner, selectedStage, searchQuery],
    queryFn: () => inboxApi.get('/leads', {
      owner: selectedOwner || undefined,
      stage: selectedStage || undefined,
      search: searchQuery || undefined,
    }),
    refetchInterval: 15000,
  });

  const leads = data?.items || [];

  // Group leads by stage for Kanban board
  const leadsByStage = useMemo(() => {
    const map = {};
    stages.forEach((st) => { map[st.key] = []; });
    leads.forEach((l) => {
      if (!map[l.stage_key]) map[l.stage_key] = [];
      map[l.stage_key].push(l);
    });
    return map;
  }, [leads, stages]);

  const totalBudget = leads.reduce((acc, l) => acc + (Number(l.budget) || 0), 0);
  const totalWonValue = leads.filter((l) => l.stage_kind === 'won').reduce((acc, l) => acc + (Number(l.booking_value) || 0), 0);

  return (
    <div className="pms-shell min-h-screen bg-slate-50 p-6 space-y-6 font-sans">
      {/* Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Users className="w-6 h-6 text-soul-blue" />
            CRM Lead Pipeline
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Manage sales leads, track conversion stages, log follow-ups, and link bookings directly to PMS.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick Metrics */}
          <div className="hidden lg:flex items-center gap-4 bg-slate-50 px-4 py-2 rounded-xl border border-slate-200 text-xs">
            <div>
              <span className="text-slate-400 block font-medium">Total Pipeline Value</span>
              <strong className="text-slate-900 font-bold">{fmtMoney(totalBudget)}</strong>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="text-slate-400 block font-medium">Won Bookings Value</span>
              <strong className="text-emerald-600 font-bold">{fmtMoney(totalWonValue)}</strong>
            </div>
          </div>

          {/* View Toggle */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('kanban')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'kanban' ? 'bg-white shadow text-soul-blue' : 'text-slate-500'}`}
              title="Kanban Board View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`p-1.5 rounded-lg transition-all ${viewMode === 'table' ? 'bg-white shadow text-soul-blue' : 'text-slate-500'}`}
              title="Table List View"
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm text-xs">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by customer name, phone, booking ref…"
              className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-soul-blue/20"
            />
          </div>

          {/* Stage filter */}
          <select
            value={selectedStage}
            onChange={(e) => setSelectedStage(e.target.value)}
            className="p-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 font-medium focus:outline-none"
          >
            <option value="">All Stages</option>
            {stages.map((st) => (
              <option key={st.key} value={st.key}>{st.name_en}</option>
            ))}
          </select>

          {/* Owner filter */}
          <select
            value={selectedOwner}
            onChange={(e) => setSelectedOwner(e.target.value)}
            className="p-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 font-medium focus:outline-none"
          >
            <option value="">All Assignees</option>
            {(me?.users || []).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>

        <span className="text-slate-400 font-medium">
          Showing <strong>{leads.length}</strong> leads
        </span>
      </div>

      {/* Main Content: Kanban or Table */}
      {isLoading ? (
        <div className="p-12 text-center text-xs text-slate-400">Loading leads pipeline…</div>
      ) : viewMode === 'kanban' ? (
        /* Kanban Board View */
        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4 overflow-x-auto pb-4">
          {stages.map((st) => {
            const stageLeads = leadsByStage[st.key] || [];
            return (
              <div key={st.key} className="bg-slate-100/80 rounded-2xl p-3 border border-slate-200/80 flex flex-col min-w-[220px]">
                {/* Column Header */}
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="font-bold text-xs text-slate-800 flex items-center gap-1.5">
                    {st.name_en}
                  </h3>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-white text-slate-700 shadow-sm border border-slate-200">
                    {stageLeads.length}
                  </span>
                </div>

                {/* Lead Cards Column */}
                <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[calc(100vh-18rem)] pr-0.5">
                  {stageLeads.length === 0 ? (
                    <div className="p-6 text-center text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-xl">
                      No leads
                    </div>
                  ) : (
                    stageLeads.map((lead) => (
                      <div
                        key={lead.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-soul-blue/40 transition-all cursor-pointer space-y-2"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <h4 className="font-bold text-xs text-slate-900 truncate">
                            {lead.customer_name || 'Guest Lead'}
                          </h4>
                          <span className="text-[10px] text-slate-400 flex-shrink-0">
                            {timeAgo(lead.updated_at)}
                          </span>
                        </div>

                        {lead.project && (
                          <div className="text-[11px] text-slate-600 font-medium flex items-center gap-1">
                            📍 {lead.project} {lead.unit_type ? `· ${lead.unit_type}` : ''}
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100">
                          <span>{lead.phone || '—'}</span>
                          {lead.budget && (
                            <strong className="text-soul-blue font-bold">{fmtMoney(lead.budget)}</strong>
                          )}
                        </div>

                        {lead.next_follow_up && (
                          <div className="flex items-center gap-1 text-[10px] bg-amber-50 text-amber-800 p-1.5 rounded-md font-semibold border border-amber-200/60">
                            <Clock className="w-3 h-3" />
                            Next follow-up: {fmtDate(lead.next_follow_up)}
                          </div>
                        )}

                        {lead.conversation_id && (
                          <div className="pt-1 flex items-center justify-between text-[10px] text-slate-400">
                            <span className="flex items-center gap-1 text-soul-blue hover:underline">
                              <MessageSquare className="w-3 h-3" /> Open Chat
                            </span>
                            <span>Assignee: {lead.owner_name || '—'}</span>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Table View */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden text-xs">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold text-[11px] uppercase tracking-wider">
                <th className="p-3">Customer</th>
                <th className="p-3">Stage</th>
                <th className="p-3">Project / Unit</th>
                <th className="p-3">Budget</th>
                <th className="p-3">Assignee</th>
                <th className="p-3">Next Follow-up</th>
                <th className="p-3">Created</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="p-3 font-bold text-slate-900">
                    <div>{lead.customer_name || 'Guest Lead'}</div>
                    <div className="text-[10px] font-normal text-slate-400">{lead.phone || '—'}</div>
                  </td>
                  <td className="p-3">
                    <StageChip stageKey={lead.stage_key} />
                  </td>
                  <td className="p-3 font-medium text-slate-700">
                    {lead.project || '—'} {lead.unit_type ? `(${lead.unit_type})` : ''}
                  </td>
                  <td className="p-3 font-bold text-slate-900">
                    {fmtMoney(lead.budget)}
                  </td>
                  <td className="p-3 text-slate-600 font-medium">
                    {lead.owner_name || 'Unassigned'}
                  </td>
                  <td className="p-3 text-slate-600">
                    {lead.next_follow_up ? fmtDate(lead.next_follow_up) : '—'}
                  </td>
                  <td className="p-3 text-slate-400">
                    {fmtDate(lead.created_at)}
                  </td>
                  <td className="p-3 text-right space-x-2">
                    {lead.conversation_id && (
                      <Link
                        to={`/admin/inbox?c=${lead.conversation_id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 text-soul-blue hover:bg-blue-100 font-semibold"
                      >
                        <MessageSquare className="w-3.5 h-3.5" /> Chat
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setSelectedLeadId(lead.id)}
                      className="px-2.5 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200 font-semibold"
                    >
                      View Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Selected Lead Details Modal */}
      {selectedLeadId && (
        <Modal
          open={Boolean(selectedLeadId)}
          onClose={() => setSelectedLeadId(null)}
          title="Lead Details & Actions"
          size="lg"
        >
          <LeadPanel
            leadId={selectedLeadId}
            onUpdated={() => {
              refetch();
              setSelectedLeadId(null);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

// React useMemo import helper
import { useMemo } from 'react';
