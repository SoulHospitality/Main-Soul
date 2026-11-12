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
import DataTable from './DataTable';
import { DeveloperPicker, isDeveloperAccount, manualAccountOptions, rangeParams, useCustomAccounts } from './shared';

export function ManualEntriesTab({ fromDate, toDate, rangeParams: params }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const emptyForm = {
    from_account: '',
    to_account: '',
    amount: '',
    entry_date: new Date().toISOString().slice(0, 10),
    notes: '',
    developer_id: '',
  };
  const [form, setForm] = useState(emptyForm);
  const needsDeveloper = isDeveloperAccount(form.from_account) || isDeveloperAccount(form.to_account);
  const pettyDrawer = [form.to_account, form.from_account].find(
    (code) => code && code !== '108000' && getAccount(code)?.parent_code === '108000'
  );
  const customAccounts = useCustomAccounts();
  const accountOptions = useMemo(() => manualAccountOptions(), [customAccounts]);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-manual', fromDate, toDate],
    queryFn: () => api.get('/financial-system/manual-entries', { params }).then((r) => r.data),
  });
  const createEntry = useMutation({
    mutationFn: (payload) =>
      editId
        ? api.patch(`/financial-system/manual-entries/${editId}`, payload)
        : api.post('/financial-system/manual-entries', payload),
    onSuccess: () => {
      toast.success(editId ? t('pms.fin.manual.entryUpdated') : t('pms.fin.manual.entryAdded'));
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      setShowForm(false);
      setEditId(null);
      setForm(emptyForm);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  function openNew() {
    setEditId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEdit(row) {
    setEditId(row.id);
    setForm({
      from_account: row.credit_account_code || '',
      to_account: row.debit_account_code || '',
      amount: String(row.amount ?? ''),
      entry_date: String(row.entry_date || '').slice(0, 10),
      notes: row.notes || '',
      developer_id: row.developer_id ? String(row.developer_id) : '',
    });
    setShowForm(true);
  }
  const removeEntry = useMutation({
    mutationFn: (id) => api.delete(`/financial-system/manual-entries/${id}`),
    onSuccess: () => {
      toast.success(t('pms.fin.manual.entryRemoved'));
      qc.invalidateQueries({ queryKey: ['financial-system-manual'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      setDeleteId(null);
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  if (isLoading) return <LoadingSpinner />;
  const entries = data?.entries || [];
  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <p className="text-sm text-gray-500">{t('pms.fin.manual.description')}</p>
        <button type="button" className="btn-primary text-sm" onClick={openNew}>
          <Plus className="w-4 h-4" /> {t('pms.fin.manual.addEntry')}
        </button>
      </div>
      <DataTable
        rows={entries}
        exportName="journal-entries"
        emptyText={t('pms.fin.manual.noEntries')}
        initialSort={{ key: 'entry_date', dir: 'desc' }}
        columns={[
          { key: 'entry_date', label: t('pms.fin.manual.date'), nowrap: true, value: (r) => String(r.entry_date || '').slice(0, 10), render: (r) => formatDate(r.entry_date) },
          { key: 'credit_account_code', label: t('pms.fin.manual.fromAccount'), value: (r) => `${r.credit_account_code || ''} ${getAccount(r.credit_account_code)?.name || r.entry_type || ''}`, render: (r) => (r.credit_account_code ? <span><span className="me-1 font-mono text-[11px] text-gray-400">{r.credit_account_code}</span>{getAccount(r.credit_account_code)?.name || r.entry_type}</span> : <span className="capitalize text-gray-500">{r.entry_type}</span>) },
          { key: 'debit_account_code', label: t('pms.fin.manual.toAccount'), value: (r) => `${r.debit_account_code || ''} ${getAccount(r.debit_account_code)?.name || ''}`, render: (r) => (r.debit_account_code ? <span><span className="me-1 font-mono text-[11px] text-gray-400">{r.debit_account_code}</span>{getAccount(r.debit_account_code)?.name || '—'}</span> : <span className="capitalize text-gray-500">{'—'}</span>) },
          { key: 'notes', label: t('pms.fin.notes'), value: (r) => `${r.developer_name ? r.developer_name + ' · ' : ''}${r.notes || r.description || ''}`, render: (r) => <span className="block max-w-[16rem] truncate">{r.developer_name ? <span className="font-medium">{r.developer_name} · </span> : null}{r.notes || r.description || '—'}</span> },
          { key: 'amount', label: t('pms.fin.amount'), align: 'end', money: true, total: true },
          {
            key: 'actions',
            label: '',
            sortable: false,
            noExport: true,
            value: () => '',
            render: (row) => (
              <span className="whitespace-nowrap">
                {!String(row.notes || '').startsWith('Payment calendar #') ? (
                  <button type="button" className="p-1.5 text-gray-400 hover:text-soul-blue" title={t('pms.fin.manual.editEntry')} onClick={() => openEdit(row)}>
                    <PenLine className="w-4 h-4" />
                  </button>
                ) : null}
                <button type="button" className="p-1.5 text-gray-400 hover:text-rose-600" onClick={() => setDeleteId(row.id)}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </span>
            ),
          },
        ]}
      />
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('pms.fin.manual.editEntryTitle') : t('pms.fin.manual.addEntryTitle')}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>{t('pms.fin.cancel')}</button>
            <button
              type="submit"
              form="manual-entry-form"
              className="btn-primary"
              disabled={createEntry.isPending}
            >
              {t('pms.fin.save')}
            </button>
          </>
        }
      >
        <form
          id="manual-entry-form"
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.from_account || !form.to_account) {
              toast.error(t('pms.fin.manual.chooseFrom'));
              return;
            }
            if (form.from_account === form.to_account) {
              toast.error(t('pms.fin.manual.fromHint'));
              return;
            }
            if (needsDeveloper && !form.developer_id) {
              toast.error(t('pms.fin.developers.required'));
              return;
            }
            createEntry.mutate({
              developer_id: needsDeveloper ? Number(form.developer_id) : undefined,
              entry_type: 'journal',
              from_account: form.from_account,
              to_account: form.to_account,
              amount: parseFloat(form.amount),
              entry_date: form.entry_date,
              notes: form.notes.trim() || undefined,
            });
          }}
        >
          <div>
            <label className="label">{t('pms.fin.manual.fromAccount')}</label>
            <SearchableSelect
              className="w-full"
              value={form.from_account}
              onChange={(v) => setForm((f) => ({ ...f, from_account: v }))}
              placeholder={t('pms.fin.manual.chooseFrom')}
              options={accountOptions}
              required
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('pms.fin.manual.fromHint')}</p>
          </div>
          <div>
            <label className="label">{t('pms.fin.manual.toAccount')}</label>
            <SearchableSelect
              className="w-full"
              value={form.to_account}
              onChange={(v) => setForm((f) => ({ ...f, to_account: v }))}
              placeholder={t('pms.fin.manual.chooseTo')}
              options={accountOptions}
              required
            />
            <p className="text-[11px] text-gray-400 mt-1">{t('pms.fin.manual.toHint')}</p>
          </div>
          {needsDeveloper ? (
            <DeveloperPicker value={form.developer_id} onChange={(v) => setForm((f) => ({ ...f, developer_id: v }))} />
          ) : null}
          {pettyDrawer ? (
            <p className="text-xs text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">
              {pettyDrawer === form.to_account
                ? t('pms.fin.manual.pettyIn', { drawer: getAccount(pettyDrawer)?.name || pettyDrawer })
                : t('pms.fin.manual.pettyOut', { drawer: getAccount(pettyDrawer)?.name || pettyDrawer })}
            </p>
          ) : null}
          <div>
            <label className="label">{t('pms.fin.amountEgp')}</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="input w-full"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('pms.fin.manual.date')}</label>
            <input
              type="date"
              min={FINANCIAL_EPOCH}
              className="input w-full"
              value={form.entry_date}
              onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('pms.fin.notes')}</label>
            <textarea
              className="input w-full min-h-[80px]"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder={t('pms.fin.manual.notesPlaceholder')}
            />
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        title={t('pms.fin.manual.deleteTitle')}
        message={t('pms.fin.manual.deleteMessage')}
        confirmText={t('pms.fin.delete')}
        danger
        onConfirm={() => removeEntry.mutate(deleteId)}
        loading={removeEntry.isPending}
      />
    </div>
  );
}
