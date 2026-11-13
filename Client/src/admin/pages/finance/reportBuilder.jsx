import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  BarChart3,
  BookOpen,
  Building2,
  FileSpreadsheet,
  FileText,
  Landmark,
  Printer,
  Receipt,
  Scale,
  Table2,
  Users,
  Wallet,
  Clock,
  Percent,
} from 'lucide-react';
import api from '../../api/axios';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { useFinLocale } from '../../context/FinLocaleContext';
import { exportReport } from '../../utils/reportExport';
import { manualAccountOptions } from './shared';

const DATASETS = [
  { id: 'income_statement', icon: BarChart3 },
  { id: 'balance_sheet', icon: Scale },
  { id: 'trial_balance', icon: BookOpen },
  { id: 'general_ledger', icon: FileText, account: true },
  { id: 'cash_book', icon: Landmark, account: true },
  { id: 'revenue_by', icon: Building2, group: true },
  { id: 'payments_received', icon: Wallet },
  { id: 'receivables_aging', icon: Clock },
  { id: 'owner_trust', icon: Users },
  { id: 'vendor_payables', icon: Receipt },
  { id: 'expenses_by_account', icon: Table2 },
  { id: 'tax_summary', icon: Percent },
];

const GROUPS = ['unit', 'project', 'channel', 'owner', 'month', 'sales_person'];
const PREVIEW_ROWS = 150;

function cell(value) {
  if (typeof value === 'number') {
    return value.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
  }
  return value ?? '';
}

/** Pick a report, a period and (where it applies) a grouping or account; preview it and save it. */
export function ReportBuilderPage({ params }) {
  const { t, isRtl } = useFinLocale();
  const [dataset, setDataset] = useState('income_statement');
  const [group, setGroup] = useState('unit');
  const [account, setAccount] = useState('');
  const [busy, setBusy] = useState('');
  const def = DATASETS.find((d) => d.id === dataset) || DATASETS[0];
  const accountOptions = useMemo(() => [{ value: '', label: t('pms.fin.builder.allAccounts') }, ...manualAccountOptions()], [t]);

  const query = {
    dataset,
    from_date: params?.from_date,
    to_date: params?.to_date,
    basis: params?.basis,
    ...(def.group ? { group } : {}),
    ...(def.account && account ? { account } : {}),
  };
  const { data, isFetching, error } = useQuery({
    queryKey: ['financial-system-report-builder', query],
    queryFn: () => api.get('/financial-system/report-builder', { params: query }).then((r) => r.data),
    staleTime: 60000,
  });

  async function save(format) {
    if (!data) return;
    setBusy(format);
    try {
      const result = await exportReport({ ...data, title: t(`pms.fin.builder.ds.${dataset}`, { defaultValue: data.title }) + (def.group ? ` — ${t(`pms.fin.builder.groups.${group}`)}` : ''), dir: isRtl ? 'rtl' : 'ltr' }, format);
      if (result === 'printed') toast(t('pms.fin.builder.longPrinted'));
      else if (format !== 'print') toast.success(t('pms.fin.builder.saved'));
    } catch {
      toast.error(t('pms.fin.failed'));
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-soul-line bg-white p-4">
        <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('pms.fin.builder.choose')}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {DATASETS.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setDataset(id)}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-start text-sm transition-colors ${
                dataset === id ? 'border-soul-blue bg-soul-blue/5 text-soul-blue' : 'border-soul-line hover:bg-black/[0.02]'
              }`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block font-medium">{t(`pms.fin.builder.ds.${id}`)}</span>
                <span className="block text-xs text-gray-500">{t(`pms.fin.builder.hint.${id}`)}</span>
              </span>
            </button>
          ))}
        </div>
        {(def.group || def.account) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {def.group && (
              <div>
                <label className="label">{t('pms.fin.builder.groupBy')}</label>
                <select className="input w-full" value={group} onChange={(e) => setGroup(e.target.value)}>
                  {GROUPS.map((g) => <option key={g} value={g}>{t(`pms.fin.builder.groups.${g}`)}</option>)}
                </select>
              </div>
            )}
            {def.account && (
              <div>
                <label className="label">{t('pms.fin.builder.account')}</label>
                <SearchableSelect className="w-full" value={account} onChange={setAccount} options={accountOptions} placeholder={t('pms.fin.builder.allAccounts')} />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-soul-line bg-white">
        <div className="flex flex-col gap-3 border-b border-soul-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="font-semibold text-soul-blue">{t(`pms.fin.builder.ds.${dataset}`)}{def.group ? ` — ${t(`pms.fin.builder.groups.${group}`)}` : ''}</h2>
            <p className="text-xs text-gray-500">{data?.subtitle || ''}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {[['pdf', 'PDF', FileText], ['xlsx', 'Excel', FileSpreadsheet], ['csv', 'CSV', Table2], ['print', t('pms.fin.builder.print'), Printer]].map(([id, label, Icon]) => (
              <button key={id} type="button" className={id === 'pdf' ? 'btn-primary !py-1.5 text-xs' : 'btn-secondary !py-1.5 text-xs'} disabled={!data || Boolean(busy) || isFetching} onClick={() => save(id)}>
                <Icon className="h-3.5 w-3.5" /> {busy === id ? '…' : label}
              </button>
            ))}
          </div>
        </div>

        {isFetching && !data ? (
          <div className="p-8"><LoadingSpinner /></div>
        ) : error ? (
          <p className="p-6 text-sm text-rose-600">{error.response?.data?.error || t('pms.fin.failed')}</p>
        ) : data ? (
          <div className={`space-y-6 p-4 ${isFetching ? 'opacity-60' : ''}`}>
            {data.stats?.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {data.stats.map((s) => (
                  <div key={s.label} className="rounded-xl bg-[var(--pms-accent-soft,#f1f5f9)] px-3 py-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-500">{s.label}</div>
                    <div className="text-base font-semibold tabular-nums">{cell(s.value)}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {data.sections.map((section) => (
              <div key={section.title}>
                <h3 className="mb-2 text-sm font-semibold text-gray-700">{section.title}</h3>
                <div className="overflow-x-auto rounded-xl border border-soul-line">
                  <table className="min-w-full text-sm" data-report-title={section.title}>
                    <thead className="bg-gray-50">
                      <tr>
                        {section.columns.map((c) => (
                          <th key={c.label} className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 ${c.align === 'right' ? 'text-end' : 'text-start'}`}>{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                        <tr key={i} className="border-t border-soul-line">
                          {row.map((v, j) => (
                            <td key={j} className={`px-3 py-1.5 ${section.columns[j]?.align === 'right' ? 'text-end tabular-nums whitespace-nowrap' : ''} ${typeof v === 'number' && v < 0 ? 'text-rose-600' : ''}`}>{cell(v)}</td>
                          ))}
                        </tr>
                      ))}
                      {!section.rows.length && (
                        <tr><td colSpan={section.columns.length} className="px-3 py-4 text-center text-gray-400">{t('pms.fin.builder.empty')}</td></tr>
                      )}
                    </tbody>
                    {section.totals ? (
                      <tfoot className="border-t-2 border-gray-300 font-semibold">
                        <tr>
                          {section.totals.map((v, j) => (
                            <td key={j} className={`px-3 py-2 ${section.columns[j]?.align === 'right' ? 'text-end tabular-nums whitespace-nowrap' : ''}`}>{cell(v)}</td>
                          ))}
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
                {section.rows.length > PREVIEW_ROWS && (
                  <p className="mt-1 text-xs text-gray-500">{t('pms.fin.builder.previewCut', { shown: PREVIEW_ROWS, total: section.rows.length })}</p>
                )}
              </div>
            ))}
            {data.note ? <p className="text-xs text-gray-500">{data.note}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
