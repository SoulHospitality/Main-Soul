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
import { HistoryList, useWorkspace } from './workspace';
import { GROUP_META, IconFor, rangeParams, useInvalidateAccounts } from './shared';

export function SubAccountAddModal({ open, onClose, groupId = '', defaultParent = '' }) {
  const { t } = useFinLocale();
  const invalidate = useInvalidateAccounts();
  const [name, setName] = useState('');
  const [parentCode, setParentCode] = useState(defaultParent);

  const parentOptions = CHART_OF_ACCOUNTS
    .filter((a) => (!groupId || a.group === groupId) && !a.virtual && isBuiltinAccount(a.code))
    .map((a) => ({
      value: a.code,
      label: `${a.code} — ${a.name}`,
      group: ACCOUNT_GROUPS[a.group] || a.group,
    }));

  const addAccount = useMutation({
    mutationFn: (payload) => api.post('/financial-system/custom-accounts', payload).then((r) => r.data),
    onSuccess: (acct) => {
      toast.success(t('pms.fin.subAccount.added', { code: acct.code }));
      invalidate();
      setName('');
      setParentCode(defaultParent);
      onClose();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const title = groupId
    ? t('pms.fin.subAccount.addTitle', { group: GROUP_META[groupId]?.label || groupId })
    : t('pms.fin.subAccount.add');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>{t('pms.fin.cancel')}</button>
          <button type="submit" form="sub-account-form" className="btn-primary" disabled={addAccount.isPending}>
            {t('pms.fin.save')}
          </button>
        </>
      }
    >
      <form
        id="sub-account-form"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parentCode) {
            toast.error(t('pms.fin.subAccount.chooseParent'));
            return;
          }
          if (!name.trim()) {
            toast.error(t('pms.fin.subAccount.nameRequired'));
            return;
          }
          addAccount.mutate({ parent_code: parentCode, name: name.trim() });
        }}
      >
        <div>
          <label className="label">{t('pms.fin.subAccount.parent')}</label>
          <SearchableSelect
            className="w-full"
            value={parentCode}
            onChange={setParentCode}
            placeholder={t('pms.fin.subAccount.chooseParent')}
            options={parentOptions}
            required
          />
          <p className="text-[11px] text-gray-400 mt-1">{t('pms.fin.subAccount.codeHint')}</p>
        </div>
        <div>
          <label className="label">{t('pms.fin.subAccount.name')}</label>
          <input
            className="input w-full"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('pms.fin.subAccount.namePlaceholder')}
            required
          />
        </div>
      </form>
    </Modal>
  );
}

export function SubAccountDeleteDialog({ code, onClose, onDeleted }) {
  const { t } = useFinLocale();
  const invalidate = useInvalidateAccounts();
  const removeAccount = useMutation({
    mutationFn: (c) => api.delete(`/financial-system/custom-accounts/${c}`),
    onSuccess: () => {
      toast.success(t('pms.fin.subAccount.deleted'));
      invalidate();
      onClose();
      onDeleted?.();
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  return (
    <ConfirmDialog
      open={Boolean(code)}
      onClose={onClose}
      title={t('pms.fin.subAccount.deleteTitle')}
      message={t('pms.fin.subAccount.deleteMessage', { code: code || '' })}
      confirmText={t('pms.fin.delete')}
      danger
      onConfirm={() => removeAccount.mutate(code)}
      loading={removeAccount.isPending}
    />
  );
}

export function GroupView({ groupId, data, onOpenAccount }) {
  const { t } = useFinLocale();
  const meta = GROUP_META[groupId] || GROUP_META.assets;
  const group = (data?.groups || []).find((g) => g.id === groupId);
  const Icon = meta.icon;
  const accounts = group?.accounts || [];
  const [addOpen, setAddOpen] = useState(false);
  const [deleteCode, setDeleteCode] = useState(null);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-soul-line bg-white p-6 flex items-center gap-4">
        <div className={`w-14 h-14 rounded-2xl ${meta.tile} text-white flex items-center justify-center`}>
          <Icon className="w-7 h-7" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-400">{groupId}</p>
          <h2 className="text-2xl font-semibold text-soul-blue">{meta.label}</h2>
          <p className="text-sm text-gray-500">{t(`pms.fin.groupMeta.${groupId}Hint`) || meta.hint} · {t('pms.fin.subAccounts', { count: accounts.length })}</p>
        </div>
        <p className="ml-auto text-2xl font-bold tabular-nums">{currency(group?.balance)}</p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button type="button" className="btn-primary text-sm" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" /> {t('pms.fin.subAccount.add')}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {accounts.map((a) => {
          const parent = a.custom && a.parent_code ? getAccount(a.parent_code) : null;
          return (
            <div key={a.code} className="relative">
              <button
                type="button"
                onClick={() => onOpenAccount(a.code)}
                className="w-full h-full rounded-2xl border border-soul-line bg-white p-5 text-left hover:border-soul-blue/40 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl ${meta.tint} flex items-center justify-center flex-shrink-0`}>
                    <IconFor code={a.parent_code || a.code} group={groupId} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-mono text-gray-400 flex items-center gap-1">
                      {a.code}
                      {!a.custom && (
                        <span title={t('pms.fin.subAccount.systemLocked')} aria-label={t('pms.fin.subAccount.systemLocked')}>
                          <Lock className="w-3 h-3 text-gray-300" />
                        </span>
                      )}
                    </p>
                    <p className="font-semibold text-soul-blue leading-snug">{a.name}</p>
                    {a.virtual ? (
                      <p className="text-[11px] text-amber-700 mt-1">{t('pms.fin.group.managementView')}</p>
                    ) : a.recurring ? (
                      <p className="text-[11px] text-violet-700 mt-1">{t('pms.fin.group.monthlyAutoDeduct')}</p>
                    ) : a.custom ? (
                      <p className="text-[11px] text-sky-700 mt-1">
                        {t('pms.fin.subAccount.under', { parent: parent ? `${parent.code} — ${parent.name}` : a.parent_code || '—' })}
                      </p>
                    ) : null}
                  </div>
                  {a.custom ? <span className="w-7" /> : <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />}
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <p className="text-xl font-bold tabular-nums">{currency(a.balance)}</p>
                  <p className="text-xs text-gray-400">{t('pms.fin.entries', { count: a.txn_count })}</p>
                </div>
              </button>
              {a.custom ? (
                <button
                  type="button"
                  className="absolute top-4 end-4 p-1.5 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"
                  title={t('pms.fin.subAccount.delete')}
                  aria-label={t('pms.fin.subAccount.delete')}
                  onClick={() => setDeleteCode(a.code)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {accounts.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-6">{t('pms.fin.group.allEmpty')}</p>
      ) : null}

      <SubAccountAddModal key={addOpen ? 'open' : 'closed'} open={addOpen} onClose={() => setAddOpen(false)} groupId={groupId} />
      <SubAccountDeleteDialog code={deleteCode} onClose={() => setDeleteCode(null)} />
    </div>
  );
}

export function AccountView({ code, fromDate, toDate, basis, onOpenTxn, onDeleted }) {
  const { t } = useFinLocale();
  const [addOpen, setAddOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const params = rangeParams(fromDate, toDate, basis);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-account', code, params],
    queryFn: () => api.get(`/financial-system/accounts/${code}`, { params }).then((r) => r.data),
    enabled: Boolean(code),
  });

  if (isLoading) return <LoadingSpinner />;
  const account = data?.account || getAccount(code) || { code, name: code };
  const rows = data?.transactions || [];
  const meta = GROUP_META[account.group] || GROUP_META.assets;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-soul-line bg-white p-6">
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl ${meta.tile} text-white flex items-center justify-center`}>
            <IconFor code={code} group={account.group} className="w-7 h-7" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-mono text-gray-400">{account.code}</p>
            <h2 className="text-2xl font-semibold text-soul-blue">{account.name}</h2>
            <p className="text-sm text-gray-500 capitalize">
              {ACCOUNT_GROUPS[account.group] || account.group}
              {account.virtual ? ` · ${t('pms.fin.account.managementView')}` : ''}
              {account.recurring ? ` · ${t('pms.fin.account.monthlyAutomatic')}` : ''}
            </p>
            {account.custom && account.parent_code ? (
              <p className="text-xs text-sky-700 mt-1">
                {t('pms.fin.subAccount.under', {
                  parent: `${account.parent_code} — ${getAccount(account.parent_code)?.name || ''}`,
                })}
              </p>
            ) : null}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">{t('pms.fin.balance')}</p>
            <p className="text-3xl font-bold tabular-nums text-soul-blue">{currency(account.balance)}</p>
          </div>
        </div>
        {!account.virtual && (
          <div className="mt-4 pt-4 border-t border-soul-line flex flex-wrap items-center gap-3">
            {account.custom ? (
              <button
                type="button"
                className="btn-secondary text-sm text-rose-700 inline-flex items-center gap-1.5"
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="w-4 h-4" /> {t('pms.fin.subAccount.delete')}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="btn-secondary text-sm inline-flex items-center gap-1.5"
                  onClick={() => setAddOpen(true)}
                >
                  <Plus className="w-4 h-4" /> {t('pms.fin.subAccount.addUnder')}
                </button>
                <span className="text-[11px] text-gray-400 inline-flex items-center gap-1">
                  <Lock className="w-3 h-3" /> {t('pms.fin.subAccount.systemLocked')}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <SubAccountAddModal
        key={addOpen ? `open-${code}` : 'closed'}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        groupId={account.group}
        defaultParent={account.custom ? '' : code}
      />
      <SubAccountDeleteDialog
        code={deleteOpen ? code : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onDeleted}
      />

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-soul-line">
          <h3 className="font-semibold">{t('pms.fin.account.transactionLog')}</h3>
          <p className="text-xs text-gray-500">{t('pms.fin.account.transactionLogHint')}</p>
        </div>
        <div className="p-3">
          <DataTable
            rows={rows.map((row) => ({ ...row, key: `${row.id}-${row.side}`, inflow: row.side === 'debit' ? Number(row.amount) || 0 : 0, outflow: row.side === 'debit' ? 0 : Number(row.amount) || 0 }))}
            rowKey={(r) => r.key}
            exportName={`account-${code}`}
            emptyText={t('pms.fin.account.noMovements')}
            onRowClick={(r) => onOpenTxn(r.id)}
            initialSort={{ key: 'date', dir: 'desc' }}
            dense
            filters={[
              { id: 'in', label: t('pms.fin.table.moneyIn'), test: (r) => r.side === 'debit' },
              { id: 'out', label: t('pms.fin.table.moneyOut'), test: (r) => r.side !== 'debit' },
            ]}
            columns={[
              { key: 'date', label: t('pms.fin.table.date'), nowrap: true, render: (r) => formatDate(r.date) },
              { key: 'description', label: t('pms.fin.table.description'), render: (r) => <span className="font-medium">{r.description}</span> },
              { key: 'counterparty', label: t('pms.fin.table.details'), value: (r) => r.counterparty || r.type, render: (r) => <span className="text-xs text-gray-500">{r.counterparty || String(r.type || '').replace(/_/g, ' ')}</span> },
              { key: 'inflow', label: t('pms.fin.table.debit'), align: 'end', money: true, total: true, render: (r) => (r.inflow ? <span className="text-emerald-700">{currency(r.inflow)}</span> : '') },
              { key: 'outflow', label: t('pms.fin.table.credit'), align: 'end', money: true, total: true, render: (r) => (r.outflow ? <span className="text-rose-700">{currency(r.outflow)}</span> : '') },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

export function TransactionView({ txnId, fromDate, toDate, basis }) {
  const { t } = useFinLocale();
  const { openTimeline } = useWorkspace();
  const params = rangeParams(fromDate, toDate, basis);
  const { data, isLoading, error } = useQuery({
    queryKey: ['financial-system-txn', txnId, params],
    queryFn: () =>
      api.get(`/financial-system/transactions/${encodeURIComponent(txnId)}`, { params }).then((r) => r.data),
    enabled: Boolean(txnId),
  });

  if (isLoading) return <LoadingSpinner />;
  if (error || !data) {
    return (
      <div className="rounded-2xl border border-soul-line bg-white p-10 text-center text-gray-500">
        {t('pms.fin.txn.notInPeriod')}
      </div>
    );
  }

  const meta = data.meta || {};
  const flow = data.flow || {};

  return (
    <div className="space-y-6">
      {meta.reservation_id ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-soul-blue/20 bg-soul-blue-50/50 px-5 py-3">
          <p className="text-sm text-soul-blue">{t('pms.fin.txn.fromStay', { guest: meta.guest_name || '#' + meta.reservation_id })}</p>
          <button type="button" className="btn-secondary text-sm" onClick={() => openTimeline(meta.reservation_id)}>
            {t('pms.fin.txn.openTimeline')}
          </button>
        </div>
      ) : null}
      <div className="rounded-2xl border border-soul-line bg-white p-6">
        <p className="text-[11px] font-mono text-gray-400">{data.id}</p>
        <h2 className="text-2xl font-semibold text-soul-blue mt-1">{data.description}</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100 capitalize">{data.type.replace('_', ' ')}</span>
          <span className="text-xs px-2 py-1 rounded-full bg-slate-100">{formatDate(data.date)}</span>
          <span className={`text-xs px-2 py-1 rounded-full ${data.balanced ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {data.balanced ? t('pms.fin.txn.balanced') : t('pms.fin.txn.checkLines')}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-center">
        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-5">
          <p className="text-[11px] uppercase tracking-wider text-rose-700">{t('pms.fin.txn.from')}</p>
          <p className="font-mono text-xs text-gray-400 mt-2">{flow.from_account || '—'}</p>
          <p className="font-semibold text-soul-blue">{flow.from_name || '—'}</p>
        </div>
        <div className="flex flex-col items-center justify-center py-2">
          <ArrowRight className="w-8 h-8 text-soul-blue hidden md:block" />
          <p className="text-lg font-bold tabular-nums">{currency(data.debit || data.credit)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5">
          <p className="text-[11px] uppercase tracking-wider text-emerald-700">{t('pms.fin.txn.to')}</p>
          <p className="font-mono text-xs text-gray-400 mt-2">{flow.to_account || '—'}</p>
          <p className="font-semibold text-soul-blue">{flow.to_name || '—'}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b font-semibold">{t('pms.fin.txn.journalLines')}</div>
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.txn.thAccount')}</th>
              <th>{t('pms.fin.txn.thMemo')}</th>
              <th className="text-right">{t('pms.fin.txn.thDebit')}</th>
              <th className="text-right">{t('pms.fin.txn.thCredit')}</th>
            </tr>
          </thead>
          <tbody>
            {(data.lines || []).map((line, i) => (
              <tr key={i}>
                <td>
                  <div className="font-mono text-[11px] text-gray-400">{line.account}</div>
                  <div className="font-medium">{line.account_name}</div>
                </td>
                <td className="text-gray-500">{line.memo}</td>
                <td className="text-right tabular-nums">{line.debit ? currency(line.debit) : '—'}</td>
                <td className="text-right tabular-nums">{line.credit ? currency(line.credit) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-soul-line bg-white p-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {meta.guest_name && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.guest')}</p>
            <p className="font-medium">{meta.guest_name}</p>
          </div>
        )}
        {meta.unit_name && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.unit')}</p>
            <p className="font-medium">{meta.unit_name}{meta.project ? ` · ${meta.project}` : ''}</p>
          </div>
        )}
        {meta.payment_method && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.paymentMethod')}</p>
            <p className="font-medium capitalize">{String(meta.payment_method).replace('_', ' ')}</p>
          </div>
        )}
        {meta.channel && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.channel')}</p>
            <p className="font-medium">{meta.channel}</p>
          </div>
        )}
        {meta.created_at && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.booked')}</p>
            <p className="font-medium">{formatDate(meta.created_at)}</p>
          </div>
        )}
        {meta.check_in && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.stay')}</p>
            <p className="font-medium">
              {formatDate(meta.check_in)} → {formatDate(meta.check_out)}
            </p>
          </div>
        )}
        {meta.total_amount != null && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.guestTotalCollectedOutstanding')}</p>
            <p className="font-medium tabular-nums">
              {currency(meta.total_amount)} · {currency(meta.amount_paid)} · {currency(meta.outstanding)}
            </p>
          </div>
        )}
        {meta.automatic && (
          <div>
            <p className="text-xs text-gray-400">{t('pms.fin.txn.posting')}</p>
            <p className="font-medium">{t('pms.fin.txn.monthlyAutoDeduction')}</p>
          </div>
        )}
        {meta.notes && (
          <div className="sm:col-span-2">
            <p className="text-xs text-gray-400">{t('pms.fin.txn.notes')}</p>
            <p>{meta.notes}</p>
          </div>
        )}
      </div>
      <SourceHistory meta={meta} />
    </div>
  );
}

/** Who created, changed or approved the record behind a book entry. */
function SourceHistory({ meta }) {
  const { t } = useFinLocale();
  const source = meta.payment_id
    ? ['payment', meta.payment_id]
    : meta.expense_id
      ? ['expense', meta.expense_id]
      : meta.manual_id
        ? ['financial_manual_entry', meta.manual_id]
        : meta.reservation_id
          ? ['reservation', meta.reservation_id]
          : null;
  const { data } = useQuery({
    queryKey: ['financial-system-history', source?.[0], source?.[1]],
    queryFn: () => api.get('/financial-system/history', { params: { entity_type: source[0], entity_id: source[1] } }).then((r) => r.data),
    enabled: Boolean(source),
  });
  if (!source) return null;
  return (
    <div className="rounded-2xl border border-soul-line bg-white p-6">
      <h3 className="mb-3 font-semibold">{t('pms.fin.txn.history')}</h3>
      {data?.items?.length ? <HistoryList items={data.items} /> : <p className="text-sm text-gray-400">{t('pms.fin.txn.noHistory')}</p>}
    </div>
  );
}
