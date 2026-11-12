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

export function TaxTab({ rangeParams: params }) {
  const { t } = useFinLocale();
  const [showPack, setShowPack] = useState(false);
  const toDate = params.to_date || new Date().toISOString().slice(0, 10);
  const packMonth = toDate.slice(0, 7);
  const { data, isLoading } = useQuery({
    queryKey: ['financial-system-tax', params],
    queryFn: () => api.get('/financial-system/tax', { params }).then((r) => r.data),
  });
  const { data: packData, isLoading: packLoading } = useQuery({
    queryKey: ['financial-system-tax-pack', packMonth],
    queryFn: () => api.get(`/financial-system/tax-filing-pack/${packMonth}`).then((r) => r.data),
    enabled: showPack,
  });
  if (isLoading) return <LoadingSpinner />;
  const liability = data?.liability || {};
  const vat = liability.output_vat || {};
  const wht = liability.withholding || {};
  const vatReturn = data?.vat_return || {};
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-amber-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.outputVat', { pct: VAT_OUTPUT_PCT })}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.output_vat ?? vat.vat_amount)}</p>
        </div>
        <div className="rounded-2xl border border-sky-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.inputVat')}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.input_vat)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.vatReturn')}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(vatReturn.net_vat_payable)}</p>
        </div>
        <div className="rounded-2xl border border-violet-200 bg-white p-5">
          <p className="text-xs text-gray-500">{t('pms.fin.tax.withholding', { std: WHT_STANDARD_PCT, reduced: WHT_REDUCED_PCT })}</p>
          <p className="text-2xl font-bold mt-2 tabular-nums">{currency(wht.total_wht)}</p>
        </div>
      </div>

      <button type="button" className="btn-secondary" onClick={() => setShowPack(!showPack)}>
        <FileSpreadsheet className="w-4 h-4" /> {showPack ? t('pms.fin.tax.hideFilingPack') : t('pms.fin.tax.showFilingPack')} {t('pms.fin.tax.filingPack', { month: packMonth })}
      </button>

      {showPack && (
        packLoading ? <LoadingSpinner /> : (
          <div className="space-y-4">
            {/* VAT Output detail */}
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.tax.vatOutputDetail')}</div>
              <SmartTable name="tax-1"><table className="table text-sm">
                <thead><tr><th>{t('pms.fin.tax.category')}</th><th className="text-right">{t('pms.fin.tax.taxableBase')}</th><th className="text-right">{t('pms.fin.tax.vatPct', { pct: VAT_OUTPUT_PCT })}</th></tr></thead>
                <tbody>
                  <tr>
                    <td>{t('pms.fin.tax.commissionRevenue')}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.commission_base)}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.commission_vat)}</td>
                  </tr>
                  <tr>
                    <td>{t('pms.fin.tax.cleaningRevenue')}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.cleaning_base)}</td>
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.cleaning_vat)}</td>
                  </tr>
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td>{t('pms.fin.tax.totalOutputVat')}</td>
                    <td />
                    <td className="text-right tabular-nums">{currency(packData?.vat_output?.total)}</td>
                  </tr>
                </tfoot>
              </table></SmartTable>
            </div>

            {/* VAT Input detail */}
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.tax.vatInputDetail')}</div>
              <SmartTable name="tax-2"><table className="table text-sm">
                <thead><tr><th>{t('pms.fin.tax.category')}</th><th className="text-right">{t('pms.fin.tax.inputVatLabel')}</th></tr></thead>
                <tbody>
                  {Object.entries(packData?.vat_input?.by_category || {}).map(([cat, amt]) => (
                    <tr key={cat}><td className="capitalize">{cat}</td><td className="text-right tabular-nums">{currency(amt)}</td></tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td>{t('pms.fin.tax.totalInputVat')}</td><td className="text-right tabular-nums">{currency(packData?.vat_input?.total)}</td></tr>
                </tfoot>
              </table></SmartTable>
            </div>

            {/* Net VAT reconciliation */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-2">
              <h4 className="font-semibold">{t('pms.fin.tax.netVatReconciliation')}</h4>
              <div className="flex justify-between text-sm"><span>{t('pms.fin.tax.outputVatLabel')}</span><span className="tabular-nums">{currency(packData?.vat_output?.total)}</span></div>
              <div className="flex justify-between text-sm"><span>{t('pms.fin.tax.inputVatShort')}</span><span className="tabular-nums">−{currency(packData?.vat_input?.total)}</span></div>
              <div className="flex justify-between font-bold border-t pt-2"><span>{t('pms.fin.tax.netVatPayable')}</span><span className="tabular-nums">{currency(packData?.net_vat_payable)}</span></div>
              {packData?.reconciliation && (
                <div className="pt-2 border-t text-xs text-gray-500 space-y-1">
                  <p>{t('pms.fin.tax.bookOutput', { book: currency(packData.reconciliation.book_output_vat), computed: currency(packData.reconciliation.computed_output_vat), diff: currency(packData.reconciliation.output_diff) })}</p>
                  <p>{t('pms.fin.tax.bookInput', { book: currency(packData.reconciliation.book_input_vat), computed: currency(packData.reconciliation.computed_input_vat), diff: currency(packData.reconciliation.input_diff) })}</p>
                </div>
              )}
            </div>

            {/* WHT detail by vendor */}
            <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
              <div className="px-6 py-3 border-b font-semibold">{t('pms.fin.tax.whtDetailByVendor')}</div>
              <SmartTable name="tax-3"><table className="table text-sm">
                <thead><tr><th>{t('pms.fin.tax.vendor')}</th><th>{t('pms.fin.tax.category')}</th><th className="text-right">{t('pms.fin.amount')}</th><th className="text-right">{t('pms.fin.tax.rate')}</th><th className="text-right">{t('pms.fin.tax.wht')}</th></tr></thead>
                <tbody>
                  {(packData?.wht?.lines || []).map((l) => (
                    <tr key={l.expense_id}>
                      <td>{l.vendor}</td>
                      <td className="capitalize">{l.category}</td>
                      <td className="text-right tabular-nums">{currency(l.amount)}</td>
                      <td className="text-right tabular-nums">{l.wht_rate_pct}%</td>
                      <td className="text-right tabular-nums">{currency(l.wht_amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td colSpan={4}>{t('pms.fin.tax.totalWhtPayable')}</td><td className="text-right tabular-nums">{currency(packData?.wht?.total)}</td></tr>
                </tfoot>
              </table></SmartTable>
            </div>
          </div>
        )
      )}
    </div>
  );
}
