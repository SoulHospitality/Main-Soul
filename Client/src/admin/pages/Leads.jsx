import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Clock, Download, LayoutGrid, List, MessageSquare, Search, Users } from 'lucide-react';
import * as XLSX from 'xlsx';
import Modal from '../components/ui/Modal';
import { inboxApi, errorMessage } from '../inbox/api';
import { useInbox } from '../inbox/InboxContext';
import { CHANNELS, CONVERSATION_TYPES, fmtDate, fmtMoney, fmtSeconds, timeAgo } from '../inbox/utils';
import { StageChip } from '../inbox/ui';
import LeadPanel from '../inbox/LeadPanel';

const fmtStamp = (ms) => (ms ? new Date(Number(ms)).toLocaleString('en-GB', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const minutes = (sec) => (sec == null ? '' : Math.round((Number(sec) / 60) * 10) / 10);

/** One row per lead with everything we know, for the Excel export. */
function exportRow(l) {
  return {
    'Lead #': l.id,
    Customer: l.customer_name || '',
    Phone: l.phone || '',
    Email: l.email || '',
    Status: l.stage_name || l.stage_key,
    'Lost reason': l.lost_reason || '',
    'Lost note': l.lost_note || '',
    Assignee: l.owner_name || '',
    'Created by': l.created_by_name || '',
    Channel: CHANNELS[l.channel_kind]?.label || l.channel_kind || '',
    'Who they are': CONVERSATION_TYPES[l.chat_type] || '',
    Source: l.source || '',
    Campaign: l.campaign || '',
    Project: l.project || '',
    'Unit type': l.unit_type || '',
    'Check-in': l.check_in || '',
    'Check-out': l.check_out || '',
    Guests: l.guests ?? '',
    Budget: l.budget || '',
    Temperature: l.temperature || '',
    'Booking ref': l.booking_ref || '',
    'Booking value (EGP)': l.booking_value != null ? Number(l.booking_value) : '',
    'Reservation #': l.reservation_id || '',
    'Guest messages': Number(l.guest_messages) || 0,
    'Staff replies': Number(l.agent_messages) || 0,
    'First response (min)': minutes(l.first_response_seconds),
    'Avg response (min)': minutes(l.avg_response_seconds),
    'Next follow-up': fmtStamp(l.next_follow_up),
    'First message': fmtStamp(l.first_message_at),
    'Last guest message': fmtStamp(l.last_guest_message_at),
    Created: fmtStamp(l.created_at),
    Updated: fmtStamp(l.updated_at),
    Qualified: fmtStamp(l.qualified_at),
    Done: fmtStamp(l.won_at),
    Closed: fmtStamp(l.closed_at),
    'Chat #': l.conversation_id || '',
    'Chat status': l.chat_status || '',
  };
}

export default function LeadsPage() {
  const { me } = useInbox();
  const [viewMode, setViewMode] = useState('table');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [stage, setStage] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const stages = me?.stages || [];

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['inbox-leads', owner, stage, search],
    queryFn: () => inboxApi.get('/leads', { owner: owner || undefined, stage: stage || undefined, search: search.trim() || undefined }),
    refetchInterval: 30000,
    placeholderData: (prev) => prev,
  });
  const leads = useMemo(() => data?.items || [], [data]);
  const canSeeAll = Boolean(data?.can_see_all);

  const byStage = useMemo(() => {
    const map = Object.fromEntries(stages.map((st) => [st.key, []]));
    for (const l of leads) (map[l.stage_key] ||= []).push(l);
    return map;
  }, [leads, stages]);

  const doneValue = leads.filter((l) => l.stage_kind === 'won').reduce((a, l) => a + (Number(l.booking_value) || 0), 0);

  const exportExcel = async () => {
    setExporting(true);
    try {
      const res = await inboxApi.get('/leads', { owner: owner || undefined, stage: stage || undefined, search: search.trim() || undefined, export: 1 });
      const rows = (res?.items || []).map(exportRow);
      if (!rows.length) return toast.error('No leads to export');
      const ws = XLSX.utils.json_to_sheet(rows);
      ws['!cols'] = Object.keys(rows[0]).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Leads');
      XLSX.writeFile(wb, `leads-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success(`${rows.length} leads exported`);
    } catch (err) {
      toast.error(errorMessage(err, 'Export failed'));
    } finally {
      setExporting(false);
    }
  };

  const selected = leads.find((l) => l.id === selectedId) || null;

  return (
    <div className="min-w-0 space-y-4 font-sans">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900">
            <Users className="h-6 w-6 text-soul-blue" /> Leads
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {canSeeAll ? 'Every lead on the inbox.' : 'Leads you own and leads from chats you are on.'} Response time counts working hours only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
            <div>
              <span className="block font-medium text-slate-400">Leads</span>
              <strong className="text-slate-900">{leads.length}</strong>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="block font-medium text-slate-400">Avg response</span>
              <strong className="text-slate-900">{fmtSeconds(data?.summary?.avg_response_seconds)}</strong>
            </div>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <span className="block font-medium text-slate-400">Done value</span>
              <strong className="text-emerald-700">{fmtMoney(doneValue)}</strong>
            </div>
          </div>
          <button type="button" onClick={exportExcel} disabled={exporting} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-soul-blue px-3 font-semibold text-white hover:bg-soul-blue/90 disabled:opacity-60">
            <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-100 p-1">
            <button type="button" onClick={() => setViewMode('table')} className={`rounded-lg p-1.5 ${viewMode === 'table' ? 'bg-white text-soul-blue shadow' : 'text-slate-500'}`} title="List" aria-label="List">
              <List className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setViewMode('kanban')} className={`rounded-lg p-1.5 ${viewMode === 'kanban' ? 'bg-white text-soul-blue shadow' : 'text-slate-500'}`} title="Board" aria-label="Board">
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-sm">
        <label className="relative min-w-[200px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone or booking ref" className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 focus:outline-none focus:ring-2 focus:ring-soul-blue/20" />
        </label>
        <select value={stage} onChange={(e) => setStage(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 font-medium text-slate-700">
          <option value="">All statuses</option>
          {stages.map((st) => (
            <option key={st.key} value={st.key}>{st.name_en}</option>
          ))}
        </select>
        {canSeeAll ? (
          <select value={owner} onChange={(e) => setOwner(e.target.value)} className="h-9 rounded-lg border border-slate-200 bg-slate-50 px-2 font-medium text-slate-700">
            <option value="">All staff</option>
            {(me?.users || []).filter((u) => u.active).map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{errorMessage(error, 'Could not load leads')}</div>
      ) : isLoading ? (
        <div className="p-12 text-center text-xs text-slate-400">Loading leads…</div>
      ) : !leads.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">No leads match.</div>
      ) : viewMode === 'kanban' ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {stages.map((st) => {
            const list = byStage[st.key] || [];
            return (
              <div key={st.key} className="flex w-64 shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-100/80 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h3 className="text-xs font-bold text-slate-800">{st.name_en}</h3>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-extrabold text-slate-700">{list.length}</span>
                </div>
                <div className="max-h-[calc(100vh-20rem)] flex-1 space-y-2 overflow-y-auto pr-0.5">
                  {list.map((lead) => (
                    <button key={lead.id} type="button" onClick={() => setSelectedId(lead.id)} className="block w-full space-y-1.5 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-soul-blue/40 hover:shadow-md">
                      <div className="flex items-start justify-between gap-1">
                        <p className="truncate text-xs font-bold text-slate-900">{lead.customer_name || 'Guest'}</p>
                        <span className="shrink-0 text-[10px] text-slate-400">{timeAgo(lead.updated_at)}</span>
                      </div>
                      {lead.project ? <p className="text-[11px] font-medium text-slate-600">📍 {lead.project}</p> : null}
                      <p className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>{lead.phone || '—'}</span>
                        <span title="Average response">{lead.avg_response_seconds != null ? `⏱ ${fmtSeconds(lead.avg_response_seconds)}` : ''}</span>
                      </p>
                      <p className="text-[10px] text-slate-400">{lead.owner_name || 'Unassigned'}</p>
                    </button>
                  ))}
                  {!list.length ? <p className="rounded-xl border border-dashed border-slate-200 p-5 text-center text-[11px] text-slate-400">No leads</p> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white text-xs shadow-sm">
          <table className="w-full min-w-[900px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <th className="p-3">Customer</th>
                <th className="p-3">Status</th>
                <th className="p-3">Project</th>
                <th className="p-3">Dates</th>
                <th className="p-3">Assignee</th>
                <th className="p-3 text-right">Avg response</th>
                <th className="p-3">Next follow-up</th>
                <th className="p-3">Created</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leads.map((lead) => (
                <tr key={lead.id} className="hover:bg-slate-50/80">
                  <td className="p-3 font-bold text-slate-900">
                    <div>{lead.customer_name || 'Guest'}</div>
                    <div className="text-[10px] font-normal text-slate-400">{lead.phone || '—'} · {CHANNELS[lead.channel_kind]?.label || '—'}</div>
                  </td>
                  <td className="p-3"><StageChip stageKey={lead.stage_key} /></td>
                  <td className="p-3 font-medium text-slate-700">{lead.project || '—'}</td>
                  <td className="p-3 text-slate-600">{lead.check_in ? `${fmtDate(lead.check_in)} → ${fmtDate(lead.check_out)}` : '—'}</td>
                  <td className="p-3 font-medium text-slate-600">{lead.owner_name || 'Unassigned'}</td>
                  <td className="p-3 text-right tabular-nums text-slate-700" title={lead.first_response_seconds != null ? `First reply ${fmtSeconds(lead.first_response_seconds)} · ${lead.replies_count} replies` : ''}>
                    {fmtSeconds(lead.avg_response_seconds)}
                  </td>
                  <td className="p-3 text-slate-600">
                    {lead.next_follow_up ? (
                      <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(lead.next_follow_up)}</span>
                    ) : '—'}
                  </td>
                  <td className="p-3 text-slate-400">{fmtDate(lead.created_at)}</td>
                  <td className="space-x-1.5 whitespace-nowrap p-3 text-right">
                    {lead.conversation_id ? (
                      <Link to={`/admin/inbox?c=${lead.conversation_id}`} className="inline-flex items-center gap-1 rounded bg-blue-50 px-2.5 py-1 font-semibold text-soul-blue hover:bg-blue-100">
                        <MessageSquare className="h-3.5 w-3.5" /> Chat
                      </Link>
                    ) : null}
                    <button type="button" onClick={() => setSelectedId(lead.id)} className="rounded bg-slate-100 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-200">
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected ? (
        <Modal open onClose={() => setSelectedId(null)} title={`Lead · ${selected.customer_name || 'Guest'}`} size="lg">
          <LeadPanel
            lead={selected}
            onChanged={() => {
              refetch();
            }}
          />
        </Modal>
      ) : null}
    </div>
  );
}
