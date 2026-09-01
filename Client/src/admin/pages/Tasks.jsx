import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ListTodo, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import { ROLE_LABELS } from '../utils/permissions';
import Modal from '../components/ui/Modal';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchableSelect from '../components/ui/SearchableSelect';
import { formatDate } from '../utils/formatters';

const EMPTY_FORM = { assignee_id: '', title: '', description: '', deadline: '' };

function isOverdue(deadline) {
  const iso = String(deadline || '').slice(0, 10);
  if (!iso) return false;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  return iso < today;
}

export default function Tasks() {
  const qc = useQueryClient();
  const { canAssignStaffTasks, isTaskAssignee } = usePermissions();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['staff-tasks'],
    queryFn: () => api.get('/staff-tasks').then((r) => r.data),
  });

  const { data: assignees = [] } = useQuery({
    queryKey: ['staff-task-assignees'],
    queryFn: () => api.get('/staff-tasks/assignees').then((r) => r.data),
    enabled: canAssignStaffTasks,
  });

  const canAdd = canAssignStaffTasks && assignees.length > 0;

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/staff-tasks', payload).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff-tasks'] });
      toast.success('Task sent');
      setModalOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Could not add task'),
  });

  const openAdd = () => {
    setForm({
      ...EMPTY_FORM,
      assignee_id: assignees.length === 1 ? String(assignees[0].id) : '',
    });
    setModalOpen(true);
  };

  const handleSave = () => {
    if (!form.assignee_id) {
      toast.error('Choose who this task is for');
      return;
    }
    if (!String(form.title || '').trim()) {
      toast.error('Title is required');
      return;
    }
    if (!form.deadline) {
      toast.error('Deadline is required');
      return;
    }
    createMutation.mutate({
      assignee_id: Number(form.assignee_id),
      title: form.title.trim(),
      description: form.description.trim(),
      deadline: form.deadline,
    });
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="page-header mb-0">
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">
            {isTaskAssignee
              ? 'Tasks assigned to you by your manager. You will also receive them by email.'
              : canAdd
                ? 'Assign a title, description, and deadline. Only you can add tasks for people who report to you.'
                : 'You can add tasks only for Marketing and PR or Web Developer staff who report to you.'}
          </p>
        </div>
        {canAdd && (
          <button type="button" onClick={openAdd} className="btn-primary">
            <Plus className="w-4 h-4" /> Add task
          </button>
        )}
      </div>

      {!tasks.length ? (
        <EmptyState
          icon={ListTodo}
          title={isTaskAssignee ? 'No tasks yet' : 'No tasks assigned'}
          subtitle={
            isTaskAssignee
              ? 'When your manager adds a task, it will show up here and in your email.'
              : canAdd
                ? 'Add a task for someone on your team.'
                : 'Assign Marketing and PR or Web Developer staff to yourself in Users first.'
          }
          action={
            canAdd ? (
              <button type="button" onClick={openAdd} className="btn-primary">
                <Plus className="w-4 h-4" /> Add task
              </button>
            ) : null
          }
        />
      ) : (
        <ul className="space-y-3">
          {tasks.map((task) => {
            const overdue = isOverdue(task.deadline);
            return (
              <li key={task.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-soul-blue">{task.title}</h2>
                    {!isTaskAssignee && (
                      <p className="text-xs text-soul-muted mt-0.5">
                        For {task.assignee_name} ({ROLE_LABELS[task.assignee_role] || task.assignee_role})
                      </p>
                    )}
                    {isTaskAssignee && task.created_by_name && (
                      <p className="text-xs text-soul-muted mt-0.5">From {task.created_by_name}</p>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg ${
                      overdue ? 'bg-rose-50 text-rose-800' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    <CalendarDays className="w-3.5 h-3.5" />
                    {formatDate(task.deadline)}
                    {overdue ? ' · overdue' : ''}
                  </span>
                </div>
                {task.description ? (
                  <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">{task.description}</p>
                ) : (
                  <p className="mt-3 text-sm text-soul-muted">No description</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New task"
        footer={
          <>
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={createMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending ? 'Sending…' : 'Send task'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label">Assign to *</label>
            <SearchableSelect
              value={form.assignee_id}
              onChange={(v) => setForm((f) => ({ ...f, assignee_id: v }))}
              placeholder="Choose a team member…"
              options={assignees.map((u) => ({
                value: String(u.id),
                label: `${u.full_name} (${ROLE_LABELS[u.role] || u.role})`,
              }))}
            />
          </div>
          <div>
            <label className="label">Title *</label>
            <input
              className="input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Short task name"
            />
          </div>
          <div>
            <label className="label">Description</label>
            <textarea
              className="input min-h-[120px]"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="What needs to be done"
            />
          </div>
          <div>
            <label className="label">Deadline *</label>
            <input
              type="date"
              className="input w-48"
              value={form.deadline}
              onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
