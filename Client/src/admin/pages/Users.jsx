import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Key, Users as UsersIcon, CheckCircle, XCircle, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import { usePermissions } from '../hooks/usePermissions';
import { useSortableTable } from '../hooks/useSortableTable';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchFilter from '../components/ui/SearchFilter';
import SortTh from '../components/ui/SortTh';
import SearchableSelect from '../components/ui/SearchableSelect';
import { ROLE_LABELS, ROLE_COLORS, creatableRoles } from '../utils/permissions';
import { getRoleTheme } from '../utils/roleTheme';
import { currency, formatDate } from '../utils/formatters';
import { TEMP_STAFF_PASSWORD } from '../utils/passwordRules';

function avatarStyle(role) {
  return { background: getRoleTheme(role).avatarBg };
}

const EMPTY_FORM = {
  full_name: '',
  email: '',
  role: 'reservations',
  base_salary: '',
  is_active: 1,
  sales_commission_pct: 0,
};

function UserForm({ form, setForm, isEdit, roleOptions, isAdmin }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {isEdit
          ? 'Salary edits by HR require admin approval before they apply.'
          : `Creates login with auto Staff ID and temporary password ${TEMP_STAFF_PASSWORD}. User must change password on first login.`}
      </p>
      <div className="form-grid">
        <div>
          <label className="label">Full Name *</label>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            placeholder="John Smith"
          />
        </div>
        <div>
          <label className="label">Email *</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="name@company.com"
          />
        </div>
        <div>
          <label className="label">Role *</label>
          <SearchableSelect
            value={form.role}
            onChange={(v) => setForm((f) => ({ ...f, role: v }))}
            placeholder="Select role…"
            options={roleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          />
        </div>
        <div>
          <label className="label">Base Salary (EGP) *</label>
          <input
            type="number"
            min="0"
            step="1"
            className="input"
            value={form.base_salary}
            onChange={(e) => setForm((f) => ({ ...f, base_salary: e.target.value }))}
            placeholder="8000"
          />
          {!isAdmin && isEdit && (
            <p className="mt-1 text-[11px] text-amber-600">Change requests go to admin for approval.</p>
          )}
        </div>
        {isEdit && (
          <div>
            <label className="label">Status</label>
            <SearchableSelect
              value={String(form.is_active)}
              onChange={(v) => setForm((f) => ({ ...f, is_active: parseInt(v, 10) }))}
              options={[
                { value: '1', label: 'Active' },
                { value: '0', label: 'Inactive' },
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const { isAdmin, role } = usePermissions();
  const roleOptions = creatableRoles(role);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const filtered = users.filter(
    (u) =>
      (!search ||
        u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.staff_code?.toLowerCase().includes(search.toLowerCase()) ||
        u.username?.toLowerCase().includes(search.toLowerCase())) &&
      (!filterRole || u.role === filterRole)
  );

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(filtered, 'full_name', 'asc');

  const saveMutation = useMutation({
    mutationFn: (d) => (editId ? api.put(`/users/${editId}`, d) : api.post('/users', d)),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      if (!editId && res?.data) {
        setCreatedInfo(res.data);
        setModal('created');
        toast.success('Staff account created');
      } else {
        toast.success(editId ? 'User updated' : 'User created');
        setModal(null);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deactivated');
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const resetPwMutation = useMutation({
    mutationFn: (id) => api.put(`/users/${id}/reset-password`, {}),
    onSuccess: (res) => {
      toast.success(`Password reset to ${res.data?.temporaryPassword || TEMP_STAFF_PASSWORD}`);
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const approveSalaryMutation = useMutation({
    mutationFn: (id) => api.post(`/users/${id}/approve-salary`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Salary change approved');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const rejectSalaryMutation = useMutation({
    mutationFn: (id) => api.post(`/users/${id}/reject-salary`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast.success('Salary change rejected');
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, role: roleOptions[0] || 'reservations' });
    setEditId(null);
    setModal('add');
  };

  const openEdit = (u) => {
    setForm({
      full_name: u.full_name || '',
      email: u.email || '',
      role: u.role,
      base_salary: u.base_salary ?? '',
      is_active: u.is_active,
      sales_commission_pct: u.sales_commission_pct || 0,
    });
    setEditId(u.id);
    setModal('edit');
  };

  const handleSave = () => {
    if (!form.full_name?.trim() || !form.email?.trim() || form.base_salary === '') {
      toast.error('Name, email, and base salary are required');
      return;
    }
    saveMutation.mutate({
      ...form,
      base_salary: Number(form.base_salary),
    });
  };

  const filterRoleOptions = isAdmin
    ? ['admin', 'reservations', 'resale', 'hr']
    : ['reservations', 'resale', 'hr'];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="page-header mb-0">
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">
            {isAdmin ? 'Admin & HR staff accounts' : 'Create Reservations, Resale, and HR users'}
            {' · '}
            {filtered.length} user{filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={openAdd} className="btn-primary">
          <Plus className="w-4 h-4" /> Add User
        </button>
      </div>

      <SearchFilter value={search} onChange={setSearch} placeholder="Search name, email, staff ID...">
        <SearchableSelect
          className="w-52"
          value={filterRole}
          onChange={setFilterRole}
          placeholder="All Roles"
          options={[
            { value: '', label: 'All Roles' },
            ...filterRoleOptions.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
          ]}
        />
      </SearchFilter>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UsersIcon}
          title="No users found"
          action={
            <button onClick={openAdd} className="btn-primary">
              <Plus className="w-4 h-4" /> Add User
            </button>
          }
        />
      ) : (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <SortTh col="full_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    User
                  </SortTh>
                  <SortTh col="staff_code" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Staff ID
                  </SortTh>
                  <SortTh col="role" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Role
                  </SortTh>
                  <SortTh col="base_salary" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Base Salary
                  </SortTh>
                  <SortTh col="is_active" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Status
                  </SortTh>
                  <SortTh col="created_at" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Created
                  </SortTh>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                          style={avatarStyle(u.role)}
                        >
                          {u.full_name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{u.full_name}</div>
                          {u.email && <div className="text-xs text-gray-400">{u.email}</div>}
                          {u.is_first_login ? (
                            <div className="text-[10px] text-amber-600 font-medium">Must change password</div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs font-semibold">{u.staff_code || '—'}</td>
                    <td>
                      <span className={`badge ${ROLE_COLORS[u.role] || 'badge-gray'}`}>
                        {ROLE_LABELS[u.role] || u.role}
                      </span>
                    </td>
                    <td>
                      <div>{currency(u.base_salary || 0)}</div>
                      {u.salary_change_status === 'pending' && (
                        <div className="mt-1 text-[11px] text-amber-700">
                          Pending: {currency(u.pending_base_salary)}
                          {isAdmin && (
                            <div className="flex gap-1 mt-1">
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800"
                                onClick={() => approveSalaryMutation.mutate(u.id)}
                              >
                                <Check className="w-3 h-3" /> Approve
                              </button>
                              <button
                                type="button"
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800"
                                onClick={() => rejectSalaryMutation.mutate(u.id)}
                              >
                                <X className="w-3 h-3" /> Reject
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      {u.is_active ? (
                        <span className="flex items-center gap-1 text-green-600 text-xs">
                          <CheckCircle className="w-3.5 h-3.5" /> Active
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-red-500 text-xs">
                          <XCircle className="w-3.5 h-3.5" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="text-xs text-gray-400">{formatDate(u.created_at)}</td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50"
                          title="Edit"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => resetPwMutation.mutate(u.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-yellow-600 hover:bg-yellow-50"
                          title="Reset to temporary password"
                        >
                          <Key className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(u.id)}
                          className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                          title="Deactivate"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal
        open={modal === 'add' || modal === 'edit'}
        onClose={() => setModal(null)}
        title={modal === 'edit' ? 'Edit User' : 'New Staff User'}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleSave} disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? 'Saving...' : modal === 'edit' ? 'Save Changes' : 'Create User'}
            </button>
          </>
        }
      >
        <UserForm
          form={form}
          setForm={setForm}
          isEdit={modal === 'edit'}
          roleOptions={
            modal === 'edit' && isAdmin
              ? ['admin', 'reservations', 'resale', 'hr']
              : roleOptions
          }
          isAdmin={isAdmin}
        />
      </Modal>

      <Modal
        open={modal === 'created'}
        onClose={() => {
          setModal(null);
          setCreatedInfo(null);
        }}
        title="Staff account created"
        size="sm"
        footer={
          <button
            onClick={() => {
              setModal(null);
              setCreatedInfo(null);
            }}
            className="btn-primary"
          >
            Done
          </button>
        }
      >
        {createdInfo && (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Name:</span> {createdInfo.full_name}
            </p>
            <p>
              <span className="text-slate-500">Staff ID:</span>{' '}
              <span className="font-mono font-semibold">{createdInfo.staff_code || createdInfo.staffId}</span>
            </p>
            <p>
              <span className="text-slate-500">Email:</span> {createdInfo.email}
            </p>
            <p>
              <span className="text-slate-500">Temporary password:</span>{' '}
              <span className="font-mono font-semibold">{createdInfo.temporaryPassword || TEMP_STAFF_PASSWORD}</span>
            </p>
            <p className="text-xs text-amber-700 mt-2">
              Share these credentials securely. The user must change the password on first login.
            </p>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteMutation.mutate(deleteId)}
        loading={deleteMutation.isPending}
        title="Deactivate User"
        message="This will deactivate the account. They will no longer be able to log in."
        confirmText="Deactivate"
        danger
      />
    </div>
  );
}
