import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, CheckSquare, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import Badge from '../components/ui/Badge';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import { formatDate } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';
import SearchableSelect from '../components/ui/SearchableSelect';

const EMPTY_FORM = { title: '', description: '', priority: 'medium', status: 'not_started', assigned_to: '', due_date: '' };
const PRIORITY_COLORS = { low: 'bg-gray-100 text-gray-700', medium: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' };
const STATUS_COLORS = { not_started: 'bg-gray-50', in_progress: 'bg-blue-50', done: 'bg-green-50' };

function TaskForm({ form, setForm, users }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="label">Title *</label>
        <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Task title" />
      </div>
      <div>
        <label className="label">Description</label>
        <textarea className="input resize-none" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Task details..." />
      </div>
      <div className="form-grid">
        <div>
          <label className="label">Priority</label>
          <SearchableSelect value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))}
            placeholder="Select priority…"
            options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' }]}
          />
        </div>
        <div>
          <label className="label">Status</label>
          <SearchableSelect value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))}
            placeholder="Select status…"
            options={[{ value: 'not_started', label: 'Not Started' }, { value: 'in_progress', label: 'In Progress' }, { value: 'done', label: 'Done' }]}
          />
        </div>
        <div>
          <label className="label">Assigned To</label>
          <SearchableSelect value={form.assigned_to} onChange={v => setForm(f => ({ ...f, assigned_to: v }))}
            placeholder="Unassigned"
            options={[{ value: '', label: 'Unassigned' }, ...users.map(u => ({ value: String(u.id), label: u.full_name }))]}
          />
        </div>
        <div>
          <label className="label">Due Date</label>
          <input type="date" className="input" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} />
        </div>
      </div>
    </div>
  );
}

export default function Tasks() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['tasks', filterStatus, filterPriority],
    queryFn: () => api.get('/tasks', { params: { status: filterStatus || undefined, priority: filterPriority || undefined } }).then(r => r.data),
  });

  const { data: users = [] } = useQuery({
    queryKey: ['users-all'],
    queryFn: () => api.get('/users').then(r => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: (d) => editId ? api.put(`/tasks/${editId}`, d) : api.post('/tasks', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success(editId ? 'Updated' : 'Created'); setModal(false); setEditId(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/tasks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); toast.success('Deleted'); setDeleteId(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const openAdd = () => { setForm(EMPTY_FORM); setEditId(null); setModal(true); };
  const openEdit = (task) => {
    setForm({
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      status: task.status,
      assigned_to: task.assigned_to || '',
      due_date: task.due_date || '',
    });
    setEditId(task.id);
    setModal(true);
  };

  const handleSave = () => saveMutation.mutate(form);

  // Group tasks by status for kanban view
  const statuses = ['not_started', 'in_progress', 'done'];
  const tasksByStatus = statuses.map(s => ({
    status: s,
    label: s === 'not_started' ? 'To Do' : s === 'in_progress' ? 'In Progress' : 'Done',
    tasks: tasks.filter(t => t.status === s && (!filterPriority || t.priority === filterPriority)),
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="page-header mb-0">
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">{tasks.length} total task{tasks.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />New Task</button>
      </div>

      <div className="flex gap-4">
        <SearchableSelect className="w-40" value={filterPriority} onChange={setFilterPriority}
          placeholder="All Priorities"
          options={[{ value: '', label: 'All Priorities' }, ...['low','medium','high','urgent'].map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))]}
        />
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : tasks.length === 0 ? (
        <EmptyState icon={CheckSquare} title="No tasks yet" action={<button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" />New Task</button>} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {tasksByStatus.map(col => (
            <div key={col.status} className="card p-0 flex flex-col h-full">
              <div className="px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
                <h3 className="font-semibold text-gray-900">{col.label}</h3>
                <p className="text-xs text-gray-500">{col.tasks.length} task{col.tasks.length !== 1 ? 's' : ''}</p>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 p-3">
                {col.tasks.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">No tasks</p>
                ) : (
                  col.tasks.map(task => (
                    <div key={task.id} className={`p-3 rounded-lg border border-gray-200 hover:shadow-md transition-shadow ${STATUS_COLORS[task.status]}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h4 className="font-medium text-gray-900 text-sm flex-1">{task.title}</h4>
                        <div className="flex gap-1 flex-shrink-0">
                          {/* Edit: allowed for creator, assignee, or admin */}
                          <button onClick={() => openEdit(task)} className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50" title="Edit task">
                            <Edit2 className="w-3 h-3" />
                          </button>
                          {/* Delete: only creator or admin */}
                          {(isAdmin || task.created_by === user?.id) && (
                            <button onClick={() => setDeleteId(task.id)} className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50" title="Delete task">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>

                      {task.description && <p className="text-xs text-gray-600 mb-2 line-clamp-2">{task.description}</p>}

                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs px-2 py-1 rounded font-medium ${PRIORITY_COLORS[task.priority]}`}>
                          {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                        </span>
                      </div>

                      {task.assigned_to_name && (
                        <div className="text-xs text-gray-500 mb-1">
                          <span className="text-gray-600">Assigned to:</span> {task.assigned_to_name}
                        </div>
                      )}

                      {task.created_by_name && (
                        <div className="text-xs text-gray-400 mb-1">
                          <span className="text-gray-500">Created by:</span> {task.created_by_name}
                        </div>
                      )}

                      {task.due_date && (
                        <div className="text-xs text-gray-500">
                          <span className="text-gray-600">Due:</span> {formatDate(task.due_date)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal open={modal} onClose={() => { setModal(false); setEditId(null); }} title={editId ? 'Edit Task' : 'New Task'} size="md"
        footer={<><button onClick={() => { setModal(false); setEditId(null); }} className="btn-secondary">Cancel</button><button onClick={handleSave} disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? 'Saving...' : 'Save'}</button></>}
      >
        <TaskForm form={form} setForm={setForm} users={users} />
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteMutation.mutate(deleteId)} loading={deleteMutation.isPending}
        title="Delete Task" message="Are you sure you want to delete this task?" confirmText="Delete" danger />
    </div>
  );
}
