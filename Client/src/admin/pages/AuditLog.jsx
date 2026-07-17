import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, RefreshCw, User, Clock, Search, X } from 'lucide-react';
import api from '../api/axios';

const ACTION_COLORS = {
  CREATE_RESERVATION: 'bg-green-100 text-green-800',
  UPDATE_RESERVATION: 'bg-blue-100 text-blue-800',
  CANCEL_REQUEST:     'bg-yellow-100 text-yellow-800',
  CANCEL_APPROVED:    'bg-red-100 text-red-800',
  ADD_PAYMENT:        'bg-emerald-100 text-emerald-800',
  APPROVE_PAYMENT:    'bg-teal-100 text-teal-800',
  DELETE_PAYMENT:     'bg-orange-100 text-orange-800',
  LOGIN:              'bg-gray-100 text-gray-700',
};

function ActionBadge({ action }) {
  const cls = ACTION_COLORS[action] || 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${cls}`}>
      {action?.replace(/_/g, ' ')}
    </span>
  );
}

function fmtDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    time: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

export default function AuditLog() {
  const [search,       setSearch]       = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterUser,   setFilterUser]   = useState('');
  const [fromDate,     setFromDate]     = useState('');
  const [toDate,       setToDate]       = useState('');

  const hasFilters = search || filterAction || filterUser || fromDate || toDate;
  const clearFilters = () => { setSearch(''); setFilterAction(''); setFilterUser(''); setFromDate(''); setToDate(''); };

  const { data, isLoading, refetch, isError } = useQuery({
    queryKey: ['audit', search, filterAction, filterUser, fromDate, toDate],
    queryFn: () => api.get('/audit', { params: {
      search:      search       || undefined,
      action:      filterAction || undefined,
      user_id:     filterUser   || undefined,
      from_date:   fromDate     || undefined,
      to_date:     toDate       || undefined,
    }}).then(r => r.data),
  });

  const { data: usersData } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get('/users').then(r => r.data),
  });

  const logs    = data?.logs    || [];
  const actions = data?.actions || [];
  const users   = usersData     || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-xl">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Audit Log</h1>
              <p className="page-subtitle">سجل كامل لجميع الأحداث — Admin فقط</p>
            </div>
          </div>
        </div>
        <button onClick={() => refetch()}
          className="btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />تحديث
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="Search by name or description..."
              value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9 w-full" />
          </div>

          {/* User filter */}
          <div>
            <label className="label text-xs">User</label>
            <select value={filterUser} onChange={e => setFilterUser(e.target.value)}
              className="input w-44 text-sm">
              <option value="">All Users</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.full_name}</option>
              ))}
            </select>
          </div>

          {/* Action filter */}
          <div>
            <label className="label text-xs">Action</label>
            <select value={filterAction} onChange={e => setFilterAction(e.target.value)}
              className="input w-52 text-sm">
              <option value="">All Actions</option>
              {actions.map(a => (
                <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div>
            <label className="label text-xs">From</label>
            <input type="date" className="input w-36 text-sm"
              value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="label text-xs">To</label>
            <input type="date" className="input w-36 text-sm"
              value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>

          {hasFilters && (
            <button onClick={clearFilters} className="btn-secondary flex items-center gap-1.5 text-sm">
              <X className="w-3.5 h-3.5" />Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="card p-0">
        {isError ? (
          <div className="p-8 text-center text-red-500 text-sm">
            <p className="font-semibold mb-1">Error loading audit log</p>
            <p className="text-xs text-gray-400">Make sure the <code>audit_log</code> table exists in Supabase</p>
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm space-y-1">
            <Shield className="w-8 h-8 mx-auto mb-2 text-gray-300" />
            <p>No records found</p>
            {!hasFilters && <p className="text-xs">Make sure the <code>audit_log</code> table exists in Supabase</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th className="whitespace-nowrap">Date &amp; Time</th>
                  <th className="whitespace-nowrap">User</th>
                  <th className="whitespace-nowrap">Role</th>
                  <th className="whitespace-nowrap">Action</th>
                  <th className="whitespace-nowrap">Entity</th>
                  <th>Description</th>
                  <th className="whitespace-nowrap">IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const dt = fmtDateTime(log.created_at);
                  return (
                    <tr key={log.id}>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1.5 text-gray-700">
                          <Clock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <div>
                            <div className="font-medium text-xs">{dt.date}</div>
                            <div className="text-gray-400 text-xs">{dt.time}</div>
                          </div>
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span className="font-medium text-gray-800 text-xs">{log.user_name || '—'}</span>
                        </div>
                      </td>
                      <td>
                        <span className="text-xs text-gray-500 capitalize">{log.role || '—'}</span>
                      </td>
                      <td>
                        <ActionBadge action={log.action} />
                      </td>
                      <td className="whitespace-nowrap">
                        {log.entity_type ? (
                          <span className="text-xs text-gray-600">
                            {log.entity_type} {log.entity_id ? `#${log.entity_id}` : ''}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <p className="text-xs text-gray-600 max-w-xs">{log.description || '—'}</p>
                      </td>
                      <td>
                        <span className="text-xs text-gray-400 font-mono">{log.ip_address || '—'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400 text-center">
          يعرض آخر 500 سجل — للاستعلامات التاريخية استخدم الفلاتر
        </div>
      </div>
    </div>
  );
}
