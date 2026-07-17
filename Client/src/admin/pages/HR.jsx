import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Edit2, Trash2, Users2 } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/axios';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import { currency } from '../utils/formatters';
import SearchableSelect from '../components/ui/SearchableSelect';

const EMPTY_EMP = { name: '', phone: '', salary_system: 'full', base_salary: '', performance_pct: 40 };
const EMPTY_DED = { amount: '', reason: '', deduction_date: new Date().toISOString().split('T')[0], system_type: 'delay' };

function SalaryCalculation({ employee, deductions }) {
  const delayDeds = (deductions || []).filter(d => d.system_type === 'delay').reduce((s, d) => s + d.amount, 0);
  const perfDeds = (deductions || []).filter(d => d.system_type === 'performance').reduce((s, d) => s + d.amount, 0);

  if (employee.salary_system === 'full') {
    const net = employee.base_salary - delayDeds;
    return (
      <div className="bg-blue-50 rounded-lg px-4 py-3 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Base Salary:</span>
          <span className="font-semibold text-gray-900">{currency(employee.base_salary)}</span>
        </div>
        <div className="flex justify-between text-red-600">
          <span>Delay Deductions:</span>
          <span className="font-semibold">-{currency(delayDeds)}</span>
        </div>
        <div className="border-t border-blue-200 pt-2 flex justify-between font-bold text-lg">
          <span className="text-gray-900">Net Salary:</span>
          <span className={net >= 0 ? 'text-green-600' : 'text-red-600'}>{currency(net)}</span>
        </div>
      </div>
    );
  }

  // Split system: 60% base + 40% performance
  const basePortion = employee.base_salary * 0.6;
  const perfPortion = employee.base_salary * 0.4;
  const netBase = basePortion - delayDeds;
  const netPerf = perfPortion - perfDeds;
  const total = netBase + netPerf;

  return (
    <div className="bg-purple-50 rounded-lg px-4 py-3 space-y-2 text-sm">
      <div className="flex justify-between">
        <span className="text-gray-600">Base Salary:</span>
        <span className="font-semibold text-gray-900">{currency(employee.base_salary)}</span>
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-purple-200 pt-2">
        <div>
          <div className="text-xs text-gray-500 mb-1">Base Portion (60%)</div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-600">{currency(basePortion)}</span>
          </div>
          <div className="flex justify-between text-red-600 text-xs mb-1">
            <span>Deductions:</span>
            <span>-{currency(delayDeds)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Net:</span>
            <span className={netBase >= 0 ? 'text-green-600' : 'text-red-600'}>{currency(netBase)}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 mb-1">Performance (40%)</div>
          <div className="flex justify-between mb-1">
            <span className="text-gray-600">{currency(perfPortion)}</span>
          </div>
          <div className="flex justify-between text-red-600 text-xs mb-1">
            <span>Deductions:</span>
            <span>-{currency(perfDeds)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Net:</span>
            <span className={netPerf >= 0 ? 'text-green-600' : 'text-red-600'}>{currency(netPerf)}</span>
          </div>
        </div>
      </div>
      <div className="border-t border-purple-200 pt-2 flex justify-between font-bold text-lg">
        <span className="text-gray-900">Total Net:</span>
        <span className={total >= 0 ? 'text-green-600' : 'text-red-600'}>{currency(total)}</span>
      </div>
    </div>
  );
}

function EmployeeForm({ form, setForm }) {
  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div><label className="label">Name *</label><input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full name" /></div>
        <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
        <div>
          <label className="label">Salary System *</label>
          <SearchableSelect value={form.salary_system} onChange={v => setForm(f => ({ ...f, salary_system: v }))}
            placeholder="Select system…"
            options={[{ value: 'full', label: 'Full System' }, { value: 'split', label: 'Split System (60/40)' }]}
          />
        </div>
        <div><label className="label">Base Salary (EGP) *</label><input type="number" min="0" step="0.01" className="input" value={form.base_salary} onChange={e => setForm(f => ({ ...f, base_salary: e.target.value }))} placeholder="0.00" /></div>
      </div>
      {form.salary_system === 'split' && (
        <div>
          <label className="label">Performance Bonus %</label>
          <input type="number" min="0" max="100" step="0.5" className="input" value={form.performance_pct} onChange={e => setForm(f => ({ ...f, performance_pct: e.target.value }))} />
          <p className="text-xs text-gray-400 mt-1">Percentage of performance portion (default 40%)</p>
        </div>
      )}
    </div>
  );
}

function DeductionForm({ form, setForm, employee }) {
  return (
    <div className="space-y-4">
      <div className="form-grid">
        <div><label className="label">Amount (EGP) *</label><input type="number" min="0" step="0.01" className="input" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" /></div>
        <div><label className="label">Date *</label><input type="date" className="input" value={form.deduction_date} onChange={e => setForm(f => ({ ...f, deduction_date: e.target.value }))} /></div>
      </div>
      <div className="form-grid">
        <div><label className="label">Reason *</label><input className="input" value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g., Late arrival" /></div>
        <div>
          <label className="label">Type *</label>
          <SearchableSelect value={form.system_type} onChange={v => setForm(f => ({ ...f, system_type: v }))}
            placeholder="Select type…"
            options={[{ value: 'delay', label: 'Delay/Absence' }, { value: 'performance', label: 'Performance Issue' }]}
          />
        </div>
      </div>
    </div>
  );
}

export default function HR() {
  const qc = useQueryClient();
  const [empModal, setEmpModal] = useState(false);
  const [dedModal, setDedModal] = useState(false);
  const [empForm, setEmpForm] = useState(EMPTY_EMP);
  const [dedForm, setDedForm] = useState(EMPTY_DED);
  const [editEmpId, setEditEmpId] = useState(null);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [deleteDedId, setDeleteDedId] = useState(null);

  const { data: employees = [], isLoading } = useQuery({
    queryKey: ['employees'],
    queryFn: () => api.get('/hr/employees').then(r => r.data),
  });

  const { data: empDetail } = useQuery({
    queryKey: ['employee', selectedEmp],
    queryFn: () => api.get(`/hr/employees/${selectedEmp}`).then(r => r.data),
    enabled: !!selectedEmp,
  });

  const saveMutation = useMutation({
    mutationFn: (d) => editEmpId ? api.put(`/hr/employees/${editEmpId}`, d) : api.post('/hr/employees', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success(editEmpId ? 'Updated' : 'Created'); setEmpModal(false); setEditEmpId(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const dedMutation = useMutation({
    mutationFn: (d) => api.post('/hr/deductions', d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee', selectedEmp] }); toast.success('Deduction added'); setDedModal(false); setDedForm(EMPTY_DED); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/hr/employees/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employees'] }); toast.success('Deleted'); setDeleteId(null); setSelectedEmp(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const deleteDedMutation = useMutation({
    mutationFn: (id) => api.delete(`/hr/deductions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['employee', selectedEmp] }); toast.success('Deduction deleted'); setDeleteDedId(null); },
    onError: (e) => toast.error(e.response?.data?.error || 'Error'),
  });

  const openAdd = () => { setEmpForm(EMPTY_EMP); setEditEmpId(null); setEmpModal(true); };
  const openEdit = (emp) => { setEmpForm({ name: emp.name, phone: emp.phone || '', salary_system: emp.salary_system, base_salary: emp.base_salary, performance_pct: emp.performance_pct }); setEditEmpId(emp.id); setEmpModal(true); };
  const handleSaveEmp = () => saveMutation.mutate(empForm);
  const handleAddDed = () => { setDedForm({ ...EMPTY_DED, employee_id: selectedEmp }); setDedModal(true); };
  const handleSaveDed = () => dedMutation.mutate({ ...dedForm, employee_id: selectedEmp });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="card p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Employees</h3>
            <button onClick={openAdd} className="p-1.5 rounded text-gray-400 hover:text-primary-600 hover:bg-primary-50" title="Add"><Plus className="w-4 h-4" /></button>
          </div>
          <div className="divide-y max-h-96 overflow-y-auto">
            {isLoading ? (
              <LoadingSpinner />
            ) : employees.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">No employees yet</div>
            ) : (
              employees.filter(e => e.is_active).map(emp => (
                <button
                  key={emp.id}
                  onClick={() => setSelectedEmp(emp.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selectedEmp === emp.id ? 'bg-primary-50 border-l-4 border-primary-500' : ''}`}
                >
                  <div className="font-medium text-gray-900 text-sm">{emp.name}</div>
                  <div className="text-xs text-gray-500">{emp.salary_system === 'full' ? 'Full System' : 'Split System'}</div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="lg:col-span-2">
        {selectedEmp && empDetail ? (
          <div className="space-y-6">
            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{empDetail.name}</h3>
                  {empDetail.phone && <p className="text-sm text-gray-500">{empDetail.phone}</p>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(empDetail)} className="p-2 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"><Edit2 className="w-4 h-4" /></button>
                  <button onClick={() => setDeleteId(empDetail.id)} className="p-2 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>

              <div className="space-y-3 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-600">System:</span>
                  <span className="font-semibold text-gray-900">{empDetail.salary_system === 'full' ? 'Full System' : `Split System (60/40)`}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Base Salary:</span>
                  <span className="font-semibold text-gray-900">{currency(empDetail.base_salary)}</span>
                </div>
                {empDetail.salary_system === 'split' && (
                  <div className="flex justify-between">
                    <span className="text-gray-600">Performance %:</span>
                    <span className="font-semibold text-gray-900">{empDetail.performance_pct}%</span>
                  </div>
                )}
              </div>

              <SalaryCalculation employee={empDetail} deductions={empDetail.deductions} />
            </div>

            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-900">Salary Deductions</h4>
                <button onClick={handleAddDed} className="btn-sm btn-primary"><Plus className="w-3 h-3" />Add</button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto">
                {(empDetail.deductions || []).length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-4">No deductions recorded</p>
                ) : (
                  (empDetail.deductions || []).map(ded => (
                    <div key={ded.id} className="flex items-center justify-between p-3 rounded-lg bg-gray-50 hover:bg-gray-100">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900">{ded.reason}</div>
                        <div className="text-xs text-gray-500">{ded.deduction_date} • {ded.system_type === 'delay' ? 'Delay' : 'Performance'}</div>
                      </div>
                      <div className="text-right ml-2">
                        <div className="text-sm font-bold text-red-600">{currency(ded.amount)}</div>
                        <button onClick={() => setDeleteDedId(ded.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState icon={Users2} title="Select an employee" />
        )}
      </div>

      {/* Employee Modal */}
      <Modal open={empModal} onClose={() => { setEmpModal(false); setEditEmpId(null); }} title={editEmpId ? 'Edit Employee' : 'Add Employee'} size="md"
        footer={<><button onClick={() => { setEmpModal(false); setEditEmpId(null); }} className="btn-secondary">Cancel</button><button onClick={handleSaveEmp} disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? 'Saving...' : 'Save'}</button></>}
      >
        <EmployeeForm form={empForm} setForm={setEmpForm} />
      </Modal>

      {/* Deduction Modal */}
      <Modal open={dedModal} onClose={() => setDedModal(false)} title="Add Deduction" size="md"
        footer={<><button onClick={() => setDedModal(false)} className="btn-secondary">Cancel</button><button onClick={handleSaveDed} disabled={dedMutation.isPending} className="btn-primary">{dedMutation.isPending ? 'Saving...' : 'Add'}</button></>}
      >
        <DeductionForm form={dedForm} setForm={setDedForm} employee={empDetail} />
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => deleteMutation.mutate(deleteId)} loading={deleteMutation.isPending}
        title="Delete Employee" message="This will deactivate the employee. This action cannot be undone." confirmText="Deactivate" danger />

      <ConfirmDialog open={!!deleteDedId} onClose={() => setDeleteDedId(null)} onConfirm={() => deleteDedMutation.mutate(deleteDedId)} loading={deleteDedMutation.isPending}
        title="Delete Deduction" message="Are you sure you want to remove this deduction?" confirmText="Delete" danger />
    </div>
  );
}
