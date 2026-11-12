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

export function CloseTool({ toDate }) {
  const { t } = useFinLocale();
  const qc = useQueryClient();
  const defaultMonth = (toDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  const [month, setMonth] = useState(defaultMonth);
  const { data = [], isLoading } = useQuery({
    queryKey: ['financial-system-periods'],
    queryFn: () => api.get('/financial-system/periods').then((r) => r.data),
  });
  const { data: checklistData, isLoading: clLoading } = useQuery({
    queryKey: ['financial-system-checklist', month],
    queryFn: () => api.get(`/financial-system/close-checklist/${month}`).then((r) => r.data),
    enabled: Boolean(month),
  });
  const updateItem = useMutation({
    mutationFn: ({ itemId, body }) => api.post(`/financial-system/close-checklist/${month}/${itemId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['financial-system-checklist', month] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const close = useMutation({
    mutationFn: (yearMonth) => api.post(`/financial-system/periods/${yearMonth}/close`),
    onSuccess: () => {
      toast.success(t('pms.fin.close.monthClosed'));
      qc.invalidateQueries({ queryKey: ['financial-system-periods'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
      qc.invalidateQueries({ queryKey: ['financial-system-reports'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });
  const reopen = useMutation({
    mutationFn: ({ yearMonth, reason }) => api.delete(`/financial-system/periods/${yearMonth}/close`, { data: { reason } }),
    onSuccess: () => {
      toast.success(t('pms.fin.close.monthReopened'));
      qc.invalidateQueries({ queryKey: ['financial-system-periods'] });
      qc.invalidateQueries({ queryKey: ['financial-system-portal'] });
    },
    onError: (e) => toast.error(e.response?.data?.error || t('pms.fin.failed')),
  });

  const [notesItem, setNotesItem] = useState(null);
  const [notesText, setNotesText] = useState('');

  if (isLoading) return <LoadingSpinner />;

  const items = checklistData?.items || [];
  const requiredItems = items.filter((i) => i.required_before_close);
  const doneRequired = requiredItems.filter((i) => i.status === 'done' || i.status === 'skipped');
  const allRequiredDone = requiredItems.length > 0 && doneRequired.length >= requiredItems.length;
  const progress = requiredItems.length > 0 ? Math.round((doneRequired.length / requiredItems.length) * 100) : 0;

  const statusColors = {
    pending: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-amber-100 text-amber-800',
    done: 'bg-emerald-100 text-emerald-800',
    skipped: 'bg-slate-100 text-slate-600',
  };
  const nextStatus = { pending: 'in_progress', in_progress: 'done', done: 'pending', skipped: 'pending' };
  const roleColors = {
    finance: 'text-sky-700',
    finance_manager: 'text-violet-700',
    admin: 'text-rose-700',
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {t('pms.fin.close.description')}
      </p>
      <div className="rounded-2xl border border-soul-line bg-white p-5 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t('pms.fin.close.month')}</label>
          <input type="month" className="input" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
      </div>

      {/* Checklist section */}
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <div className="px-6 py-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">{t('pms.fin.close.checklist', { month })}</h3>
              <p className="text-xs text-gray-500 mt-1">{t('pms.fin.close.checklistHint')}</p>
            </div>
            <span className="text-sm font-semibold tabular-nums">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 mt-3">
            <div
              className={`h-2 rounded-full transition-all ${allRequiredDone ? 'bg-emerald-500' : 'bg-soul-blue'}`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        {clLoading ? (
          <div className="p-8"><LoadingSpinner /></div>
        ) : (
          <div className="divide-y divide-soul-line">
            {items.map((item) => (
              <div key={item.id} className="px-6 py-3 flex items-start gap-4">
                <button
                  type="button"
                  className="mt-1 flex-shrink-0"
                  onClick={() => updateItem.mutate({ itemId: item.id, body: { status: nextStatus[item.status] || 'pending' } })}
                >
                  {item.status === 'done' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <div className={`w-5 h-5 rounded-full border-2 ${item.status === 'in_progress' ? 'border-amber-500 bg-amber-100' : 'border-gray-300'}`} />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400 tabular-nums w-5">{item.task_order || ''}</span>
                    <p className={`text-sm font-medium ${item.status === 'done' ? 'line-through text-gray-400' : ''}`}>{item.title}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[item.status]}`}>{item.status}</span>
                    {item.required_before_close && <span className="text-[10px] text-rose-500">{t('pms.fin.close.required')}</span>}
                  </div>
                  {item.description && <p className="text-xs text-gray-500 mt-0.5">{item.description}</p>}
                  {item.owner_role && <p className={`text-[11px] mt-0.5 ${roleColors[item.owner_role] || 'text-gray-500'}`}>{item.owner_role}</p>}
                  {item.evidence_notes && <p className="text-xs text-emerald-700 mt-1 italic">{item.evidence_notes}</p>}
                </div>
                <button
                  type="button"
                  className="text-xs text-soul-blue hover:underline flex-shrink-0"
                  onClick={() => { setNotesItem(item); setNotesText(item.evidence_notes || ''); }}
                >
                  {t('pms.fin.close.evidenceNotes')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-soul-line bg-white p-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={close.isPending || !allRequiredDone}
          onClick={() => close.mutate(month)}
          title={!allRequiredDone ? t('pms.fin.close.completeRequiredTooltip') : ''}
        >
          <Lock className="w-4 h-4" /> {t('pms.fin.close.closeMonth')}
        </button>
        {!allRequiredDone && <span className="text-xs text-amber-700">{t('pms.fin.close.completeRequired')}</span>}
      </div>

      {/* Closed periods table */}
      <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
        <table className="table text-sm">
          <thead>
            <tr>
              <th>{t('pms.fin.close.thMonth')}</th>
              <th className="text-right">{t('pms.fin.close.thPnlTransferred')}</th>
              <th>{t('pms.fin.close.thClosedBy')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(Array.isArray(data) ? data : []).map((row) => (
              <tr key={row.year_month}>
                <td className="font-medium">{row.year_month}</td>
                <td className="text-right tabular-nums">{currency(row.pnl_amount)}</td>
                <td>{row.closed_by_name || '—'}</td>
                <td className="text-right">
                  <button type="button" className="text-xs text-amber-700 inline-flex items-center gap-1" onClick={() => {
                    const reason = window.prompt('Why is this month being reopened?');
                    if (!reason || !reason.trim()) return;
                    reopen.mutate({ yearMonth: row.year_month, reason: reason.trim() });
                  }}>
                    <Unlock className="w-3 h-3" /> {t('pms.fin.close.reopen')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Evidence notes modal */}
      <Modal open={Boolean(notesItem)} onClose={() => setNotesItem(null)} title={t('pms.fin.close.evidenceNotesTitle')} size="sm"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setNotesItem(null)}>{t('pms.fin.cancel')}</button>
            <button type="button" className="btn-primary" disabled={updateItem.isPending}
              onClick={() => { updateItem.mutate({ itemId: notesItem.id, body: { evidence_notes: notesText } }); setNotesItem(null); }}>
              {t('pms.fin.save')}
            </button>
          </>
        }
      >
        <textarea className="input w-full min-h-[120px]" value={notesText} onChange={(e) => setNotesText(e.target.value)}
          placeholder={t('pms.fin.close.evidencePlaceholder')} />
      </Modal>
    </div>
  );
}
