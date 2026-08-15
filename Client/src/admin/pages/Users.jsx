import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Edit2,
  Trash2,
  Key,
  Users as UsersIcon,
  UserCircle,
  CheckCircle,
  XCircle,
  Check,
  X,
  Link2,
} from 'lucide-react';
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

const TABS = [
  { id: 'staff', label: 'Staff', icon: UsersIcon },
  { id: 'owners', label: 'Owners', icon: UserCircle },
];

function avatarStyle(role) {
  return { background: getRoleTheme(role).avatarBg };
}

const EMPTY_STAFF_FORM = {
  full_name: '',
  email: '',
  role: 'reservations_manual',
  base_salary: '',
  is_active: 1,
  sales_commission_pct: '',
};

const EMPTY_OWNER_FORM = {
  full_name: '',
  phone: '',
  email: '',
  is_active: 1,
  unit_ids: [],
};

function OwnerUnitPicker({ selectedIds, onChange, ownerId, enabled }) {
  const [search, setSearch] = useState('');
  const { data: units = [], isLoading } = useQuery({
    queryKey: ['owner-linkable-units', ownerId || 'new'],
    queryFn: () =>
      api
        .get('/users/owners/linkable-units', {
          params: ownerId ? { owner_id: ownerId } : undefined,
        })
        .then((r) => r.data),
    enabled: Boolean(enabled),
  });

  const selected = new Set((selectedIds || []).map(Number));
  const q = search.trim().toLowerCase();
  const allUnits = Array.isArray(units) ? units : [];

  const matchesSearch = (u) => {
    if (!q) return true;
    const hay = [u.name, u.unit_number, u.title, u.project, u.unit_owner_name, u.unit_owner_phone]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  };

  const unitLabel = (u) => u.name || u.unit_number || u.title || `Unit #${u.id}`;
  const unitMeta = (u) =>
    [u.project, u.unit_owner_name ? `Listing owner: ${u.unit_owner_name}` : null]
      .filter(Boolean)
      .join(' · ') || '—';

  const linkedUnits = allUnits.filter((u) => selected.has(Number(u.id))).filter(matchesSearch);
  const availableUnits = allUnits
    .filter((u) => !selected.has(Number(u.id)))
    .filter(matchesSearch);

  // Keep selected units that might not be in the latest list (edge case) visible for unlink.
  const linkedIdsInList = new Set(allUnits.map((u) => Number(u.id)));
  const orphanLinkedIds = [...selected].filter((id) => !linkedIdsInList.has(id));

  const linkUnit = (id) => {
    const nid = Number(id);
    if (selected.has(nid)) return;
    onChange([...(selectedIds || []), nid]);
  };

  const unlinkUnit = (id) => {
    const nid = Number(id);
    onChange((selectedIds || []).filter((x) => Number(x) !== nid));
  };

  const unlinkAll = () => onChange([]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label className="label mb-0">Units for this owner</label>
        <span className="text-[11px] text-slate-400">
          {selected.size} linked · check or use Link / Unlink, then save
        </span>
      </div>
      <p className="text-[11px] text-slate-500">
        Link or unlink any rent unit for portal access. Listing owner name/phone do not need to
        match. Unlink removes a mistaken assignment.
      </p>
      <input
        className="input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search unit, project, listing owner…"
      />

      {isLoading ? (
        <div className="p-4 text-center text-xs text-slate-400 border border-slate-200 rounded-lg">
          Loading units…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-slate-700">
                Linked ({selected.size})
              </p>
              {selected.size > 0 && (
                <button
                  type="button"
                  onClick={unlinkAll}
                  className="text-[11px] font-medium text-red-600 hover:text-red-700"
                >
                  Unlink all
                </button>
              )}
            </div>
            <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
              {linkedUnits.length === 0 && orphanLinkedIds.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  No units linked yet
                </div>
              ) : (
                <>
                  {linkedUnits.map((u) => {
                    const id = Number(u.id);
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50/40"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-800 truncate">
                            {unitLabel(u)}
                          </span>
                          <span className="block text-[11px] text-slate-500 truncate">
                            {unitMeta(u)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => unlinkUnit(id)}
                          className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                        >
                          Unlink
                        </button>
                      </div>
                    );
                  })}
                  {orphanLinkedIds.map((id) => (
                    <div key={id} className="flex items-center gap-3 px-3 py-2.5 bg-emerald-50/40">
                      <span className="min-w-0 flex-1 text-sm font-medium text-slate-800">
                        Unit #{id}
                      </span>
                      <button
                        type="button"
                        onClick={() => unlinkUnit(id)}
                        className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50"
                      >
                        Unlink
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-700 mb-1.5">
              Available to link ({availableUnits.length}
              {q ? ' match' : ''})
            </p>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100 bg-white">
              {availableUnits.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400">
                  {q ? 'No matching unlinked units' : 'No unlinked units available'}
                </div>
              ) : (
                availableUnits.map((u) => {
                  const id = Number(u.id);
                  return (
                    <div key={id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-slate-800 truncate">
                          {unitLabel(u)}
                        </span>
                        <span className="block text-[11px] text-slate-500 truncate">
                          {unitMeta(u)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => linkUnit(id)}
                        className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-800 px-2 py-1 rounded hover:bg-emerald-50"
                      >
                        Link
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isReservationAgentRole(role) {
  return ['reservations_web', 'reservations_manual', 'reservations'].includes(role);
}

function StaffForm({ form, setForm, isEdit, roleOptions, isAdmin }) {
  const showCommission = isReservationAgentRole(form.role);
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
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                role: v,
                sales_commission_pct: isReservationAgentRole(v)
                  ? f.sales_commission_pct
                  : '',
              }))
            }
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
        {showCommission && (
          <div>
            <label className="label">Commission % *</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="input"
              value={form.sales_commission_pct}
              onChange={(e) => setForm((f) => ({ ...f, sales_commission_pct: e.target.value }))}
              placeholder="e.g. 1.5"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Of company commission on reservations assigned to this agent
            </p>
          </div>
        )}
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

function OwnerForm({ form, setForm, isEdit, ownerId, showUnits }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500">
        {isEdit
          ? 'Update owner profile details. Phone/login cannot be changed here.'
          : `Creates an owner portal login. Phone is the username. Temporary password ${TEMP_STAFF_PASSWORD} — owner must change it on first login.`}
      </p>
      <div className="form-grid">
        <div>
          <label className="label">Full Name *</label>
          <input
            className="input"
            value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            placeholder="Owner name"
          />
        </div>
        <div>
          <label className="label">Phone {isEdit ? '' : '*'}</label>
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="01xxxxxxxxx"
            disabled={isEdit}
          />
          {isEdit ? (
            <p className="mt-1 text-[11px] text-slate-400">Login username (read-only)</p>
          ) : (
            <p className="mt-1 text-[11px] text-slate-400">Used as the owner portal username</p>
          )}
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="Optional — auto-generated if blank"
          />
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
      {showUnits ? (
        <OwnerUnitPicker
          selectedIds={form.unit_ids || []}
          onChange={(unit_ids) => setForm((f) => ({ ...f, unit_ids }))}
          ownerId={ownerId}
          enabled
        />
      ) : null}
    </div>
  );
}

export default function Users() {
  const qc = useQueryClient();
  const { isAdmin, role } = usePermissions();
  const staffRoleOptions = creatableRoles(role).filter((r) => r !== 'owner');
  const canCreateOwners = isAdmin;

  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab') || 'staff';
  const activeTab = rawTab === 'owners' ? 'owners' : 'staff';
  const isOwnersTab = activeTab === 'owners';

  function setTab(id) {
    setSearchParams({ tab: id }, { replace: true });
  }

  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [modal, setModal] = useState(null);
  const [staffForm, setStaffForm] = useState(EMPTY_STAFF_FORM);
  const [ownerForm, setOwnerForm] = useState(EMPTY_OWNER_FORM);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [createdInfo, setCreatedInfo] = useState(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then((r) => r.data),
  });

  const { data: ownerStats = [] } = useQuery({
    queryKey: ['users-owners'],
    queryFn: () => api.get('/users/owners').then((r) => r.data),
    enabled: isOwnersTab,
  });

  const unitCountById = Object.fromEntries(
    (Array.isArray(ownerStats) ? ownerStats : []).map((o) => [o.id, o.unit_count])
  );

  const scopedUsers = users.filter((u) =>
    isOwnersTab ? u.role === 'owner' : u.role !== 'owner'
  );

  const filtered = scopedUsers.filter(
    (u) =>
      (!search ||
        u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase()) ||
        u.staff_code?.toLowerCase().includes(search.toLowerCase()) ||
        u.username?.toLowerCase().includes(search.toLowerCase())) &&
      (!filterRole || u.role === filterRole)
  );

  const { sorted, sortKey, sortDir, handleSort } = useSortableTable(
    filtered,
    'full_name',
    'asc'
  );

  const saveStaffMutation = useMutation({
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

  const saveOwnerMutation = useMutation({
    mutationFn: async (d) => {
      const { unit_ids, ...profile } = d;
      if (editId) {
        const res = await api.put(`/users/${editId}`, profile);
        if (Array.isArray(unit_ids)) {
          await api.put(`/users/owners/${editId}/units`, { unit_ids });
        }
        return res;
      }
      return api.post('/users', { ...profile, unit_ids });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users-owners'] });
      qc.invalidateQueries({ queryKey: ['owner-linkable-units'] });
      if (!editId && res?.data) {
        setCreatedInfo(res.data);
        setModal('created');
        if (res.data.unitLinkError) {
          toast.error(`Owner created, but units not linked: ${res.data.unitLinkError}`);
        } else {
          toast.success(
            res.data.unit_count
              ? `Owner created with ${res.data.unit_count} unit(s)`
              : 'Owner account created'
          );
        }
      } else {
        toast.success(editId ? 'Owner updated' : 'Owner created');
        setModal(null);
      }
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error saving'),
  });

  const linkUnitsMutation = useMutation({
    mutationFn: ({ ownerId, unit_ids }) =>
      api.put(`/users/owners/${ownerId}/units`, { unit_ids }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users-owners'] });
      qc.invalidateQueries({ queryKey: ['owner-linkable-units'] });
      toast.success('Unit links updated');
      setModal(null);
      setEditId(null);
      setOwnerForm({ ...EMPTY_OWNER_FORM });
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Error updating unit links'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['users-owners'] });
      toast.success(isOwnersTab ? 'Owner deleted' : 'User deleted');
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
    setEditId(null);
    if (isOwnersTab) {
      setOwnerForm({ ...EMPTY_OWNER_FORM });
      setModal('add-owner');
    } else {
      setStaffForm({ ...EMPTY_STAFF_FORM, role: staffRoleOptions[0] || 'reservations_manual' });
      setModal('add-staff');
    }
  };

  const openEdit = async (u) => {
    setEditId(u.id);
    if (u.role === 'owner') {
      let unit_ids = [];
      try {
        const { data } = await api.get(`/users/owners/${u.id}/units`);
        unit_ids = (Array.isArray(data) ? data : []).map((x) => x.id);
      } catch {
        unit_ids = [];
      }
      setOwnerForm({
        full_name: u.full_name || '',
        phone: u.username || '',
        email: u.email?.includes('@soul.owners.local') ? '' : u.email || '',
        is_active: u.is_active,
        unit_ids,
      });
      setModal('edit-owner');
    } else {
      setStaffForm({
        full_name: u.full_name || '',
        email: u.email || '',
        role: u.role,
        base_salary: u.base_salary ?? '',
        is_active: u.is_active,
        sales_commission_pct:
          u.sales_commission_pct != null && u.sales_commission_pct !== ''
            ? String(u.sales_commission_pct)
            : '',
      });
      setModal('edit-staff');
    }
  };

  const openLinkUnits = async (u) => {
    setEditId(u.id);
    let unit_ids = [];
    try {
      const { data } = await api.get(`/users/owners/${u.id}/units`);
      unit_ids = (Array.isArray(data) ? data : []).map((x) => x.id);
    } catch {
      unit_ids = [];
    }
    setOwnerForm({
      full_name: u.full_name || '',
      phone: u.username || '',
      email: '',
      is_active: u.is_active,
      unit_ids,
    });
    setModal('link-units');
  };

  const handleSaveStaff = () => {
    if (!staffForm.full_name?.trim() || !staffForm.email?.trim() || staffForm.base_salary === '') {
      toast.error('Name, email, and base salary are required');
      return;
    }
    if (isReservationAgentRole(staffForm.role)) {
      if (staffForm.sales_commission_pct === '' || staffForm.sales_commission_pct == null) {
        toast.error('Commission % is required for reservation agents');
        return;
      }
      const pct = Number(staffForm.sales_commission_pct);
      if (Number.isNaN(pct) || pct < 0 || pct > 100) {
        toast.error('Commission % must be between 0 and 100');
        return;
      }
    }
    saveStaffMutation.mutate({
      ...staffForm,
      base_salary: Number(staffForm.base_salary),
      sales_commission_pct: isReservationAgentRole(staffForm.role)
        ? Number(staffForm.sales_commission_pct)
        : Number(staffForm.sales_commission_pct) || 0,
    });
  };

  const handleSaveOwner = () => {
    if (!ownerForm.full_name?.trim()) {
      toast.error('Name is required');
      return;
    }
    if (!editId && !ownerForm.phone?.trim()) {
      toast.error('Phone is required for new owners');
      return;
    }
    if (editId) {
      saveOwnerMutation.mutate({
        full_name: ownerForm.full_name.trim(),
        email: ownerForm.email?.trim() || undefined,
        is_active: ownerForm.is_active,
        role: 'owner',
        base_salary: 0,
        unit_ids: ownerForm.unit_ids || [],
      });
    } else {
      saveOwnerMutation.mutate({
        full_name: ownerForm.full_name.trim(),
        phone: ownerForm.phone.trim(),
        username: ownerForm.phone.trim(),
        email: ownerForm.email?.trim() || '',
        role: 'owner',
        base_salary: 0,
        unit_ids: ownerForm.unit_ids || [],
      });
    }
  };

  const handleSaveLinkUnits = () => {
    if (!editId) return;
    linkUnitsMutation.mutate({
      ownerId: editId,
      unit_ids: ownerForm.unit_ids || [],
    });
  };

  const filterRoleOptions = isAdmin
    ? [
        'admin',
        'reservations_web',
        'reservations_manual',
        'reservations',
        'operations_supervisor',
        'operations',
        'housekeeping_supervisor',
        'housekeeping',
        'resale',
        'hr',
      ]
    : [
        'reservations_web',
        'reservations_manual',
        'reservations',
        'operations_supervisor',
        'operations',
        'housekeeping_supervisor',
        'housekeeping',
        'resale',
        'hr',
      ];

  const showAddButton = isOwnersTab ? canCreateOwners : staffRoleOptions.length > 0;
  const saving =
    saveStaffMutation.isPending ||
    saveOwnerMutation.isPending ||
    linkUnitsMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="page-header mb-0">
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">
            {isOwnersTab
              ? 'Owner portal accounts'
              : isAdmin
                ? 'Admin & HR staff accounts'
                : 'Create Reservations, Resale, and HR users'}
            {' · '}
            {filtered.length} {isOwnersTab ? 'owner' : 'user'}
            {filtered.length !== 1 ? 's' : ''}
          </p>
        </div>
        {showAddButton && (
          <button onClick={openAdd} className="btn-primary">
            <Plus className="w-4 h-4" /> {isOwnersTab ? 'Add Owner' : 'Add User'}
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl w-fit">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          const count = users.filter((u) =>
            tab.id === 'owners' ? u.role === 'owner' : u.role !== 'owner'
          ).length;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? 'bg-white text-soul-blue shadow-sm'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{tab.label}</span>
              <span
                className={`text-[11px] tabular-nums px-1.5 py-0.5 rounded-md ${
                  active ? 'bg-soul-blue/10 text-soul-blue' : 'bg-gray-200/80 text-gray-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <SearchFilter
        value={search}
        onChange={setSearch}
        placeholder={
          isOwnersTab
            ? 'Search name, phone, email...'
            : 'Search name, email, staff ID...'
        }
      >
        {!isOwnersTab && (
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
        )}
      </SearchFilter>

      {isLoading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={isOwnersTab ? UserCircle : UsersIcon}
          title={isOwnersTab ? 'No owners found' : 'No users found'}
          action={
            showAddButton ? (
              <button onClick={openAdd} className="btn-primary">
                <Plus className="w-4 h-4" /> {isOwnersTab ? 'Add Owner' : 'Add User'}
              </button>
            ) : null
          }
        />
      ) : isOwnersTab ? (
        <div className="card p-0">
          <div className="table-wrapper">
            <table className="table text-sm">
              <thead>
                <tr>
                  <SortTh col="full_name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Owner
                  </SortTh>
                  <SortTh col="username" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Phone
                  </SortTh>
                  <SortTh col="email" sortKey={sortKey} sortDir={sortDir} onSort={handleSort}>
                    Email
                  </SortTh>
                  <th>Units</th>
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
                          style={avatarStyle('owner')}
                        >
                          {u.full_name?.charAt(0)?.toUpperCase()}
                        </div>
                        <div>
                          <div className="font-medium">{u.full_name}</div>
                          {u.is_first_login ? (
                            <div className="text-[10px] text-amber-600 font-medium">
                              Must change password
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-xs font-semibold">{u.username || '—'}</td>
                    <td className="text-xs text-gray-500">
                      {u.email?.includes('@soul.owners.local') ? '—' : u.email || '—'}
                    </td>
                    <td className="tabular-nums">
                      {unitCountById[u.id] != null ? unitCountById[u.id] : '—'}
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
                        {isAdmin && (
                          <button
                            onClick={() => openLinkUnits(u)}
                            className="p-1.5 rounded text-gray-400 hover:text-emerald-600 hover:bg-emerald-50"
                            title="Link units"
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </button>
                        )}
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
                          title="Delete"
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
                  <SortTh
                    col="sales_commission_pct"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  >
                    Commission %
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
                            <div className="text-[10px] text-amber-600 font-medium">
                              Must change password
                            </div>
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
                    <td className="tabular-nums">
                      {isReservationAgentRole(u.role)
                        ? `${Number(u.sales_commission_pct || 0)}%`
                        : '—'}
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
                          title="Delete"
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
        open={modal === 'add-staff' || modal === 'edit-staff'}
        onClose={() => setModal(null)}
        title={modal === 'edit-staff' ? 'Edit User' : 'New Staff User'}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleSaveStaff} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : modal === 'edit-staff' ? 'Save Changes' : 'Create User'}
            </button>
          </>
        }
      >
        <StaffForm
          form={staffForm}
          setForm={setStaffForm}
          isEdit={modal === 'edit-staff'}
          roleOptions={
            modal === 'edit-staff' && isAdmin
              ? [
                  'admin',
                  'reservations_web',
                  'reservations_manual',
                  'reservations',
                  'operations_supervisor',
                  'operations',
                  'housekeeping_supervisor',
                  'housekeeping',
                  'resale',
                  'hr',
                ]
              : staffRoleOptions
          }
          isAdmin={isAdmin}
        />
      </Modal>

      <Modal
        open={modal === 'add-owner' || modal === 'edit-owner'}
        onClose={() => setModal(null)}
        title={modal === 'edit-owner' ? 'Edit Owner' : 'New Owner'}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleSaveOwner} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : modal === 'edit-owner' ? 'Save Changes' : 'Create Owner'}
            </button>
          </>
        }
      >
        <OwnerForm
          form={ownerForm}
          setForm={setOwnerForm}
          isEdit={modal === 'edit-owner'}
          ownerId={modal === 'edit-owner' ? editId : null}
          showUnits={isAdmin}
        />
      </Modal>

      <Modal
        open={modal === 'link-units'}
        onClose={() => setModal(null)}
        title={`Link units — ${ownerForm.full_name || 'Owner'}`}
        size="lg"
        footer={
          <>
            <button onClick={() => setModal(null)} className="btn-secondary">
              Cancel
            </button>
            <button onClick={handleSaveLinkUnits} disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Save links'}
            </button>
          </>
        }
      >
        <OwnerUnitPicker
          selectedIds={ownerForm.unit_ids || []}
          onChange={(unit_ids) => setOwnerForm((f) => ({ ...f, unit_ids }))}
          ownerId={editId}
          enabled={modal === 'link-units'}
        />
      </Modal>

      <Modal
        open={modal === 'created'}
        onClose={() => {
          setModal(null);
          setCreatedInfo(null);
        }}
        title={createdInfo?.role === 'owner' ? 'Owner account created' : 'Staff account created'}
        size="sm"
        footer={
          <>
            {createdInfo?.role === 'owner' && isAdmin && (
              <button
                onClick={() => {
                  const id = createdInfo.id;
                  const name = createdInfo.full_name;
                  setCreatedInfo(null);
                  openLinkUnits({
                    id,
                    full_name: name,
                    username: createdInfo.username,
                    is_active: createdInfo.is_active ?? 1,
                  });
                }}
                className="btn-secondary"
              >
                Link units
              </button>
            )}
            <button
              onClick={() => {
                setModal(null);
                setCreatedInfo(null);
              }}
              className="btn-primary"
            >
              Done
            </button>
          </>
        }
      >
        {createdInfo && (
          <div className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">Name:</span> {createdInfo.full_name}
            </p>
            {createdInfo.role === 'owner' ? (
              <p>
                <span className="text-slate-500">Phone / username:</span>{' '}
                <span className="font-mono font-semibold">{createdInfo.username}</span>
              </p>
            ) : (
              <p>
                <span className="text-slate-500">Staff ID:</span>{' '}
                <span className="font-mono font-semibold">
                  {createdInfo.staff_code || createdInfo.staffId}
                </span>
              </p>
            )}
            <p>
              <span className="text-slate-500">Email:</span> {createdInfo.email}
            </p>
            <p>
              <span className="text-slate-500">Temporary password:</span>{' '}
              <span className="font-mono font-semibold">
                {createdInfo.temporaryPassword || TEMP_STAFF_PASSWORD}
              </span>
            </p>
            {createdInfo.role === 'owner' && (
              <p className="text-xs text-slate-500">
                Units linked: {createdInfo.unit_count ?? 0}
                {createdInfo.unitLinkError
                  ? ` — ${createdInfo.unitLinkError}`
                  : createdInfo.unit_count
                    ? ''
                    : ' — use Link units to assign portal access'}
              </p>
            )}
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
        title={isOwnersTab ? 'Delete Owner' : 'Delete User'}
        message="This permanently deletes the account from the system. This cannot be undone."
        confirmText="Delete"
        danger
      />
    </div>
  );
}
