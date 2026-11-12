import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ClipboardList,
  CalendarDays,
  Landmark,
  Scale,
  Wallet,
  Banknote,
  Coins,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Download,
  CheckCircle2,
  PenLine,
  Plus,
  Trash2,
  BookOpen,
  PiggyBank,
  Shield,
  TrendingUp,
  Receipt,
  CircleDollarSign,
  CreditCard,
  Home,
  Zap,
  UtensilsCrossed,
  Users,
  AlertCircle,
  Settings2,
  FileSpreadsheet,
  Lock,
  Unlock,
  Building2,
  Globe,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import BankAccountPicker from '../../components/BankAccountPicker';
import { currency, formatDate, formatDateTime } from '../../utils/formatters';
import { FINANCE_BOOKS_START as FINANCIAL_EPOCH } from '../../utils/financialEpoch';
import {
  ACCOUNT_GROUPS,
  CHART_OF_ACCOUNTS,
  getAccount,
  isBuiltinAccount,
  setCustomAccounts,
  treasuryCodes,
} from '../../../lib/finance/chartOfAccounts';
import { VAT_OUTPUT_PCT, WHT_STANDARD_PCT, WHT_REDUCED_PCT } from '../../../lib/finance/taxEngine';
import { PettyCashSection } from '../PettyCash';
import { RefundApprovalSteps, refundReady } from '../../components/RefundApprovals';
import { FinLocaleProvider, useFinLocale } from '../../context/FinLocaleContext';
import { SmartTable } from './DataTable';
import { rangeParams } from './shared';

export function VendorsTool({ rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [tab, setTab] = useState('vendors');
  const [vendorModal, setVendorModal] = useState(null);
  const [invoiceModal, setInvoiceModal] = useState(false);
  const [selectedInvoices, setSelectedInvoices] = useState([]);
  const [invStatus, setInvStatus] = useState('');
  const [invVendor, setInvVendor] = useState('');

  // Vendors
  const { data: vendors = [], isLoading: vendorsLoading } = useQuery({
    queryKey: ['financial-system-vendors'],
    queryFn: () => api.get('/financial-system/vendors').then((r) => r.data),
  });
  const [vendorForm, setVendorForm] = useState({ name: '', tax_id: '', category: 'general', payment_terms_days: 30, contact_name: '', contact_phone: '', contact_email: '', bank_name: '', bank_account: '', notes: '', wht_rate_pct: 3 });
  const saveVendor = useMutation({
    mutationFn: (payload) =>
      vendorModal?.id
        ? api.put(`/financial-system/vendors/${vendorModal.id}`, payload)
        : api.post('/financial-system/vendors', payload),
    onSuccess: () => {
      toast.success(vendorModal?.id ? t('pms.fin.vendors.vendorUpdated') : t('pms.fin.vendors.vendorCreated'));
      qc.invalidateQueries({ queryKey: ['financial-system-vendors'] });
      setVendorModal(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  function openVendorEdit(v) {
    setVendorForm({
      name: v.name || '', tax_id: v.tax_id || '', category: v.category || 'general',
      payment_terms_days: v.payment_terms_days || 30, contact_name: v.contact_name || '',
      contact_phone: v.contact_phone || '', contact_email: v.contact_email || '',
      bank_name: v.bank_name || '', bank_account: v.bank_account || '',
      notes: v.notes || '', wht_rate_pct: v.wht_rate_pct ?? 3,
    });
    setVendorModal(v);
  }
  function openVendorNew() {
    setVendorForm({ name: '', tax_id: '', category: 'general', payment_terms_days: 30, contact_name: '', contact_phone: '', contact_email: '', bank_name: '', bank_account: '', notes: '', wht_rate_pct: 3 });
    setVendorModal({});
  }

  // Invoices
  const invParams = { status: invStatus || undefined, vendor_id: invVendor || undefined };
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    queryKey: ['financial-system-vendor-invoices', invStatus, invVendor],
    queryFn: () => api.get('/financial-system/vendor-invoices', { params: invParams }).then((r) => r.data),
  });
  const [invForm, setInvForm] = useState({ vendor_id: '', invoice_number: '', invoice_date: new Date().toISOString().slice(0, 10), amount: '', description: '', category: '', notes: '' });
  const createInvoice = useMutation({
    mutationFn: (payload) => api.post('/financial-system/vendor-invoices', payload),
    onSuccess: () => {
      toast.success(t('pms.fin.vendors.invoiceCreated'));
      qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] });
      qc.invalidateQueries({ queryKey: ['financial-system-vendors'] });
      setInvoiceModal(false);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const approveInv = useMutation({
    mutationFn: (id) => api.post(`/financial-system/vendor-invoices/${id}/approve`),
    onSuccess: () => { toast.success(t('pms.fin.vendors.approvedToast')); qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] }); qc.invalidateQueries({ queryKey: ['financial-system-vendors'] }); },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const rejectInv = useMutation({
    mutationFn: (id) => api.post(`/financial-system/vendor-invoices/${id}/reject`),
    onSuccess: () => { toast.success(t('pms.fin.vendors.rejectedToast')); qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] }); qc.invalidateQueries({ queryKey: ['financial-system-vendors'] }); },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const payInv = useMutation({
    mutationFn: (id) => api.post(`/financial-system/vendor-invoices/${id}/pay`, { payment_method: 'bank_transfer' }),
    onSuccess: () => { toast.success(t('pms.fin.vendors.markedPaid')); qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] }); qc.invalidateQueries({ queryKey: ['financial-system-vendors'] }); },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // Aging
  const { data: agingData, isLoading: agingLoading } = useQuery({
    queryKey: ['financial-system-vendor-aging'],
    queryFn: () => api.get('/financial-system/vendor-aging').then((r) => r.data),
    enabled: tab === 'aging',
  });

  // Payment runs
  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ['financial-system-payment-runs'],
    queryFn: () => api.get('/financial-system/payment-runs').then((r) => r.data),
    enabled: tab === 'runs',
  });
  const createRun = useMutation({
    mutationFn: (invoice_ids) => api.post('/financial-system/payment-runs', { invoice_ids }),
    onSuccess: () => {
      toast.success(t('pms.fin.vendors.paymentRunCreated'));
      setSelectedInvoices([]);
      qc.invalidateQueries({ queryKey: ['financial-system-payment-runs'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const confirmRun = useMutation({
    mutationFn: (id) => api.post(`/financial-system/payment-runs/${id}/confirm`),
    onSuccess: () => {
      toast.success(t('pms.fin.vendors.runConfirmed'));
      qc.invalidateQueries({ queryKey: ['financial-system-payment-runs'] });
      qc.invalidateQueries({ queryKey: ['financial-system-vendor-invoices'] });
      qc.invalidateQueries({ queryKey: ['financial-system-vendors'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  // Approved invoices for payment run selection
  const approvedInvoices = invoices.filter((i) => i.status === 'approved');

  function toggleInvoiceSelect(id) {
    setSelectedInvoices((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const tabs = [
    { id: 'vendors', label: t('pms.fin.vendors.tabs.vendors') },
    { id: 'invoices', label: t('pms.fin.vendors.tabs.invoices') },
    { id: 'aging', label: t('pms.fin.vendors.tabs.aging') },
    { id: 'runs', label: t('pms.fin.vendors.tabs.runs') },
  ];

  const VENDOR_CATEGORIES = [
    { value: 'general', label: t('pms.fin.vendors.general') },
    { value: 'professional', label: t('pms.fin.vendors.professional') },
    { value: 'utilities', label: t('pms.fin.vendors.utilities') },
    { value: 'rent', label: t('pms.fin.vendors.rent') },
    { value: 'maintenance', label: t('pms.fin.vendors.maintenanceCat') },
    { value: 'software', label: t('pms.fin.vendors.software') },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            className={`px-3 py-1.5 rounded-full text-sm ${tab === tabItem.id ? 'bg-soul-blue text-white' : 'bg-white border border-soul-line'}`}
            onClick={() => setTab(tabItem.id)}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {tab === 'vendors' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{t('pms.fin.vendors.vendorMasterHint')}</p>
            <button type="button" className="btn-primary text-sm" onClick={openVendorNew}>
              <Plus className="w-4 h-4" /> {t('pms.fin.vendors.addVendor')}
            </button>
          </div>
          {vendorsLoading ? <LoadingSpinner /> : (
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <SmartTable name="vendors-1"><table className="table text-sm">
                <thead>
                  <tr>
                    <th>{t('pms.fin.vendors.name')}</th>
                    <th>{t('pms.fin.vendors.category')}</th>
                    <th>{t('pms.fin.vendors.whtPct')}</th>
                    <th>{t('pms.fin.vendors.terms')}</th>
                    <th className="text-right">{t('pms.fin.vendors.outstandingCol')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {vendors.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-gray-400 py-8">{t('pms.fin.vendors.noVendors')}</td></tr>
                  ) : vendors.map((v) => (
                    <tr key={v.id} className={v.is_active === false ? 'opacity-50' : ''}>
                      <td className="font-medium">{v.name}</td>
                      <td className="capitalize">{v.category}</td>
                      <td className="tabular-nums">{v.wht_rate_pct}%</td>
                      <td className="tabular-nums">{v.payment_terms_days}d</td>
                      <td className="text-right tabular-nums font-semibold">{currency(v.outstanding)}</td>
                      <td className="text-right">
                        <button type="button" className="text-xs text-soul-blue" onClick={() => openVendorEdit(v)}>{t('pms.fin.vendors.edit')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></SmartTable>
            </div>
          )}
          <Modal
            open={Boolean(vendorModal)}
            onClose={() => setVendorModal(null)}
            title={vendorModal?.id ? t('pms.fin.vendors.editVendor') : t('pms.fin.vendors.newVendor')}
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setVendorModal(null)}>{t('pms.fin.cancel')}</button>
                <button type="submit" form="vendor-form" className="btn-primary" disabled={saveVendor.isPending}>{t('pms.fin.save')}</button>
              </>
            }
          >
            <form id="vendor-form" className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveVendor.mutate(vendorForm); }}>
              <input className="input w-full" placeholder={t('pms.fin.vendors.vendorName')} value={vendorForm.name} onChange={(e) => setVendorForm((f) => ({ ...f, name: e.target.value }))} required />
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder={t('pms.fin.vendors.taxId')} value={vendorForm.tax_id} onChange={(e) => setVendorForm((f) => ({ ...f, tax_id: e.target.value }))} />
                <select className="input" value={vendorForm.category} onChange={(e) => setVendorForm((f) => ({ ...f, category: e.target.value }))}>
                  {VENDOR_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.vendors.paymentTermsDays')}</label>
                  <input type="number" min="0" className="input w-full" value={vendorForm.payment_terms_days} onChange={(e) => setVendorForm((f) => ({ ...f, payment_terms_days: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.vendors.whtRate')}</label>
                  <input type="number" min="0" step="0.01" className="input w-full" value={vendorForm.wht_rate_pct} onChange={(e) => setVendorForm((f) => ({ ...f, wht_rate_pct: e.target.value }))} />
                </div>
              </div>
              <input className="input w-full" placeholder={t('pms.fin.vendors.contactName')} value={vendorForm.contact_name} onChange={(e) => setVendorForm((f) => ({ ...f, contact_name: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder={t('pms.fin.vendors.phone')} value={vendorForm.contact_phone} onChange={(e) => setVendorForm((f) => ({ ...f, contact_phone: e.target.value }))} />
                <input className="input" placeholder={t('pms.fin.vendors.email')} value={vendorForm.contact_email} onChange={(e) => setVendorForm((f) => ({ ...f, contact_email: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className="input" placeholder={t('pms.fin.vendors.bankName')} value={vendorForm.bank_name} onChange={(e) => setVendorForm((f) => ({ ...f, bank_name: e.target.value }))} />
                <input className="input" placeholder={t('pms.fin.vendors.bankAccount')} value={vendorForm.bank_account} onChange={(e) => setVendorForm((f) => ({ ...f, bank_account: e.target.value }))} />
              </div>
              <textarea className="input w-full min-h-[60px]" placeholder={t('pms.fin.notes')} value={vendorForm.notes} onChange={(e) => setVendorForm((f) => ({ ...f, notes: e.target.value }))} />
            </form>
          </Modal>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <select className="input text-sm w-36" value={invStatus} onChange={(e) => setInvStatus(e.target.value)}>
                <option value="">{t('pms.fin.vendors.allStatuses')}</option>
                <option value="pending">{t('pms.fin.vendors.pending')}</option>
                <option value="approved">{t('pms.fin.vendors.approved')}</option>
                <option value="paid">{t('pms.fin.vendors.paidStatus')}</option>
                <option value="rejected">{t('pms.fin.vendors.rejected')}</option>
              </select>
              <SearchableSelect
                className="w-48"
                value={invVendor}
                onChange={setInvVendor}
                placeholder={t('pms.fin.vendors.allVendors')}
                options={[
                  { value: '', label: t('pms.fin.vendors.allVendors') },
                  ...vendors.map((v) => ({ value: String(v.id), label: v.name })),
                ]}
              />
            </div>
            <button type="button" className="btn-primary text-sm" onClick={() => setInvoiceModal(true)}>
              <Plus className="w-4 h-4" /> {t('pms.fin.vendors.newInvoice')}
            </button>
          </div>
          {invoicesLoading ? <LoadingSpinner /> : (
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <SmartTable name="vendors-2"><table className="table text-sm">
                <thead>
                  <tr>
                    <th>{t('pms.fin.vendors.vendorCol')}</th>
                    <th>{t('pms.fin.vendors.invoiceNum')}</th>
                    <th>{t('pms.fin.vendors.dateCol')}</th>
                    <th>{t('pms.fin.vendors.dueCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.amountCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.whtCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.netCol')}</th>
                    <th>{t('pms.fin.vendors.statusCol')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {invoices.length === 0 ? (
                    <tr><td colSpan={9} className="text-center text-gray-400 py-8">{t('pms.fin.vendors.noInvoices')}</td></tr>
                  ) : invoices.map((inv) => (
                    <tr key={inv.id}>
                      <td className="font-medium">{inv.vendor_name}</td>
                      <td>{inv.invoice_number || '—'}</td>
                      <td>{formatDate(inv.invoice_date)}</td>
                      <td>{formatDate(inv.due_date)}</td>
                      <td className="text-right tabular-nums">{currency(inv.amount)}</td>
                      <td className="text-right tabular-nums text-gray-500">{currency(inv.wht_amount)}</td>
                      <td className="text-right tabular-nums font-semibold">{currency(inv.net_payable)}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          inv.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                          inv.status === 'approved' ? 'bg-sky-100 text-sky-800' :
                          inv.status === 'rejected' ? 'bg-rose-100 text-rose-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="text-right space-x-1">
                        {inv.status === 'pending' && (
                          <>
                            <button type="button" className="text-xs text-emerald-700" onClick={() => approveInv.mutate(inv.id)}>{t('pms.fin.approve')}</button>
                            <button type="button" className="text-xs text-rose-600" onClick={() => rejectInv.mutate(inv.id)}>{t('pms.fin.reject')}</button>
                          </>
                        )}
                        {inv.status === 'approved' && (
                          <button type="button" className="text-xs text-soul-blue" onClick={() => payInv.mutate(inv.id)}>{t('pms.fin.vendors.pay')}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></SmartTable>
            </div>
          )}
          <Modal
            open={invoiceModal}
            onClose={() => setInvoiceModal(false)}
            title={t('pms.fin.vendors.newVendorInvoice')}
            footer={
              <>
                <button type="button" className="btn-secondary" onClick={() => setInvoiceModal(false)}>{t('pms.fin.cancel')}</button>
                <button type="submit" form="invoice-form" className="btn-primary" disabled={createInvoice.isPending}>{t('pms.fin.save')}</button>
              </>
            }
          >
            <form id="invoice-form" className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              createInvoice.mutate({
                vendor_id: parseInt(invForm.vendor_id, 10),
                invoice_number: invForm.invoice_number || undefined,
                invoice_date: invForm.invoice_date,
                amount: parseFloat(invForm.amount),
                description: invForm.description || undefined,
                category: invForm.category || undefined,
                notes: invForm.notes || undefined,
              });
            }}>
              <SearchableSelect
                className="w-full"
                value={invForm.vendor_id}
                onChange={(v) => setInvForm((f) => ({ ...f, vendor_id: v }))}
                placeholder={t('pms.fin.vendors.selectVendor')}
                options={vendors.filter((v) => v.is_active !== false).map((v) => ({ value: String(v.id), label: v.name }))}
              />
              <input className="input w-full" placeholder={t('pms.fin.vendors.invoiceNumber')} value={invForm.invoice_number} onChange={(e) => setInvForm((f) => ({ ...f, invoice_number: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">{t('pms.fin.vendors.invoiceDate')}</label>
                  <input type="date" className="input w-full" value={invForm.invoice_date} onChange={(e) => setInvForm((f) => ({ ...f, invoice_date: e.target.value }))} />
                </div>
                <div>
                  <label className="label">{t('pms.fin.vendors.amountRequired')}</label>
                  <input type="number" min="0.01" step="0.01" className="input w-full" value={invForm.amount} onChange={(e) => setInvForm((f) => ({ ...f, amount: e.target.value }))} required />
                </div>
              </div>
              {invForm.vendor_id && invForm.amount > 0 && (() => {
                const v = vendors.find((x) => String(x.id) === invForm.vendor_id);
                if (!v) return null;
                const wht = Math.round(parseFloat(invForm.amount) * (parseFloat(v.wht_rate_pct) || 0) / 100 * 100) / 100;
                const net = Math.round((parseFloat(invForm.amount) - wht) * 100) / 100;
                return (
                  <div className="rounded-xl bg-slate-50 p-3 text-sm flex gap-4">
                    <span>{t('pms.fin.vendors.whtCalc', { pct: v.wht_rate_pct, wht: currency(wht) })}</span>
                    <span>{t('pms.fin.vendors.netPayable', { net: currency(net) })}</span>
                    <span>{t('pms.fin.vendors.dueIn', { days: v.payment_terms_days })}</span>
                  </div>
                );
              })()}
              <input className="input w-full" placeholder={t('pms.fin.description')} value={invForm.description} onChange={(e) => setInvForm((f) => ({ ...f, description: e.target.value }))} />
              <textarea className="input w-full min-h-[60px]" placeholder={t('pms.fin.notes')} value={invForm.notes} onChange={(e) => setInvForm((f) => ({ ...f, notes: e.target.value }))} />
            </form>
          </Modal>
        </div>
      )}

      {tab === 'aging' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{t('pms.fin.vendors.agingHint', { total: currency(agingData?.total_outstanding) })}</p>
          {agingLoading ? <LoadingSpinner /> : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {Object.entries(agingData?.buckets || {}).map(([key, b]) => (
                  <div key={key} className="rounded-2xl border border-soul-line bg-white p-4">
                    <p className="text-xs text-gray-400">{b.label}</p>
                    <p className="text-xl font-bold tabular-nums mt-1">{currency(b.amount)}</p>
                    <p className="text-xs text-gray-500">{t('pms.fin.vendors.invoicesCount', { count: b.count })}</p>
                  </div>
                ))}
              </div>
              {Object.values(agingData?.buckets || {}).map((b) =>
                (b.rows || []).length ? (
                  <div key={b.label} className="rounded-2xl border border-soul-line bg-white overflow-hidden">
                    <div className="px-6 py-3 border-b font-semibold">{b.label}</div>
                    <SmartTable name="vendors-3"><table className="table text-sm">
                      <thead>
                        <tr>
                          <th>{t('pms.fin.vendors.vendorCol')}</th>
                          <th>{t('pms.fin.vendors.invoiceNum')}</th>
                          <th>{t('pms.fin.vendors.dueCol')}</th>
                          <th className="text-right">{t('pms.fin.vendors.daysCol')}</th>
                          <th className="text-right">{t('pms.fin.vendors.amountCol')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.rows.map((r) => (
                          <tr key={r.invoice_id}>
                            <td>{r.vendor_name}</td>
                            <td>{r.invoice_number || '—'}</td>
                            <td>{formatDate(r.due_date)}</td>
                            <td className="text-right tabular-nums">{r.days}</td>
                            <td className="text-right tabular-nums font-medium">{currency(r.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></SmartTable>
                  </div>
                ) : null
              )}
            </>
          )}
        </div>
      )}

      {tab === 'runs' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            {t('pms.fin.vendors.selectApproved')}
          </p>
          {approvedInvoices.length > 0 && (
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold flex justify-between items-center">
                <span>{t('pms.fin.vendors.approvedInvoices', { count: approvedInvoices.length })}</span>
                <button
                  type="button"
                  className="btn-primary text-sm"
                  disabled={!selectedInvoices.length || createRun.isPending}
                  onClick={() => createRun.mutate(selectedInvoices)}
                >
                  {t('pms.fin.vendors.createRun', { count: selectedInvoices.length })}
                </button>
              </div>
              <SmartTable name="vendors-4"><table className="table text-sm">
                <thead>
                  <tr>
                    <th />
                    <th>{t('pms.fin.vendors.vendorCol')}</th>
                    <th>{t('pms.fin.vendors.invoiceNum')}</th>
                    <th className="text-right">{t('pms.fin.vendors.netCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {approvedInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedInvoices.includes(inv.id)}
                          onChange={() => toggleInvoiceSelect(inv.id)}
                        />
                      </td>
                      <td>{inv.vendor_name}</td>
                      <td>{inv.invoice_number || '—'}</td>
                      <td className="text-right tabular-nums">{currency(inv.net_payable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></SmartTable>
            </div>
          )}
          {runsLoading ? <LoadingSpinner /> : (
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.vendors.paymentRuns')}</div>
              <SmartTable name="vendors-5"><table className="table text-sm">
                <thead>
                  <tr>
                    <th>{t('pms.fin.vendors.id')}</th>
                    <th>{t('pms.fin.vendors.dateCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.amountCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.whtCol')}</th>
                    <th className="text-right">{t('pms.fin.vendors.netCol')}</th>
                    <th>{t('pms.fin.vendors.invoicesCol')}</th>
                    <th>{t('pms.fin.vendors.statusCol')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-gray-400 py-8">{t('pms.fin.vendors.noPaymentRuns')}</td></tr>
                  ) : runs.map((r) => (
                    <tr key={r.id}>
                      <td className="font-mono text-xs">#{r.id}</td>
                      <td>{formatDate(r.run_date)}</td>
                      <td className="text-right tabular-nums">{currency(r.total_amount)}</td>
                      <td className="text-right tabular-nums text-gray-500">{currency(r.total_wht)}</td>
                      <td className="text-right tabular-nums font-semibold">{currency(r.total_net)}</td>
                      <td className="tabular-nums">{r.invoice_count}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          r.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                          r.status === 'confirmed' ? 'bg-sky-100 text-sky-800' :
                          'bg-amber-100 text-amber-800'
                        }`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="text-right">
                        {r.status === 'draft' && (
                          <button type="button" className="btn-secondary text-xs py-1 px-2" onClick={() => confirmRun.mutate(r.id)} disabled={confirmRun.isPending}>
                            <CheckCircle2 className="w-3 h-3 inline mr-1" /> {t('pms.fin.confirm')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></SmartTable>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
