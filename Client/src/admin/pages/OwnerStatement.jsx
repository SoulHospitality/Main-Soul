import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Download, FileBarChart2, Printer } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../api/axios';
import LoadingSpinner from '../components/ui/LoadingSpinner';
import EmptyState from '../components/ui/EmptyState';
import SearchableSelect from '../components/ui/SearchableSelect';
import { unitSelectLabel } from '../utils/formatters';
import { useAuth } from '../context/AuthContext';
import { isOwnerRole as checkOwner } from '../utils/permissions';
import { FINANCIAL_EPOCH } from '../utils/financialEpoch';
import { buildOwnerStatementHtml } from '../utils/ownerStatementDoc';
import { downloadDocumentPdf, openDocument } from '../utils/brandDocument';

const cairoToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

function presetRange(key) {
  const today = cairoToday();
  const [y, m] = today.split('-').map(Number);
  const iso = (yy, mm, dd) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  const lastDay = (yy, mm) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const clamp = (d) => (d < FINANCIAL_EPOCH ? FINANCIAL_EPOCH : d);
  if (key === 'this_month') return { from: clamp(iso(y, m, 1)), to: today };
  if (key === 'last_month') {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: clamp(iso(py, pm, 1)), to: iso(py, pm, lastDay(py, pm)) };
  }
  if (key === 'this_year') return { from: clamp(iso(y, 1, 1)), to: today };
  return { from: FINANCIAL_EPOCH, to: today };
}

const PRESETS = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'this_year', label: 'This year' },
  { key: 'all', label: 'Since the start' },
];

/** Owner statement: pick a unit and period, see the statement as the document the owner receives. */
export default function OwnerStatement() {
  const { user } = useAuth();
  const isOwnerRole = checkOwner(user);
  const isStaff = !isOwnerRole;

  const [unitId, setUnitId] = useState('');
  const [preset, setPreset] = useState('this_month');
  const [range, setRange] = useState(() => presetRange('this_month'));
  const [internal, setInternal] = useState(false);
  const [requested, setRequested] = useState(null); // { unitId, from, to }
  const [pdfLoading, setPdfLoading] = useState(false);
  const frameRef = useRef(null);

  const { data: units = [], isLoading: unitsLoading } = useQuery({
    queryKey: ['owner-statement-units', isOwnerRole],
    queryFn: () => (isOwnerRole ? api.get('/owner/units') : api.get('/units')).then((r) => r.data),
  });
  const ownerSingleUnit = isOwnerRole && units.length === 1 ? String(units[0].id) : '';
  const chosenUnit = unitId || ownerSingleUnit;

  const { data, isFetching, error } = useQuery({
    queryKey: ['owner-statement', requested],
    queryFn: () =>
      api
        .get('/reports/owner-statement', {
          params: { unit_id: requested.unitId, from_date: requested.from, to_date: requested.to || undefined },
        })
        .then((r) => r.data),
    enabled: Boolean(requested?.unitId),
  });

  const html = useMemo(
    () => (data && requested ? buildOwnerStatementHtml(data, { from: requested.from, to: requested.to, internal: isStaff && internal, actions: false }) : ''),
    [data, requested, internal, isStaff]
  );

  const generate = () => {
    if (!chosenUnit) return toast.error('Choose a unit');
    if (!range.from) return toast.error('Choose the start date');
    if (range.to && range.to < range.from) return toast.error('The end date must be after the start');
    setRequested({ unitId: chosenUnit, from: range.from, to: range.to });
  };

  const print = () => {
    if (!data || !requested) return;
    const ok = openDocument(buildOwnerStatementHtml(data, { from: requested.from, to: requested.to, internal: isStaff && internal }));
    if (!ok) toast.error('Allow pop-ups to print the statement');
  };

  const downloadPdf = async () => {
    if (!data || !requested) return;
    setPdfLoading(true);
    try {
      const unitName = String(data.unit?.unit_number || data.unit?.name || 'unit').replace(/[^w-]+/g, '_');
      await downloadDocumentPdf(
        buildOwnerStatementHtml(data, { from: requested.from, to: requested.to, internal: isStaff && internal, actions: false }),
        `Owner_statement_${unitName}_${requested.from}_to_${requested.to || cairoToday()}.pdf`
      );
    } catch (err) {
      console.error('[owner statement] pdf', err);
      toast.error('Could not make the PDF here. Use Print → Save as PDF instead.');
    } finally {
      setPdfLoading(false);
    }
  };

  const fitFrame = () => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    if (doc?.body) frame.style.height = `${doc.documentElement.scrollHeight + 4}px`;
  };

  return (
    <div className="space-y-5">
      <div className="page-header mb-0">
        <h1 className="page-title">Owner statement</h1>
        <p className="page-subtitle">{isOwnerRole ? 'Your stays, earnings and expenses for any period.' : 'The statement each owner receives: stays, commission, expenses and the amount due.'}</p>
      </div>

      <div className="card">
        <h3 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
          <Building2 className="h-4 w-4 text-primary-600" /> Statement
        </h3>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_1.6fr_auto] lg:items-end">
          {!ownerSingleUnit ? (
            <div>
              <label className="label">Unit</label>
              <SearchableSelect
                value={unitId}
                onChange={(v) => setUnitId(v)}
                placeholder={unitsLoading ? 'Loading units…' : 'Choose a unit…'}
                disabled={unitsLoading}
                options={[{ value: '', label: 'Choose a unit…' }, ...units.map((u) => ({ value: String(u.id), label: unitSelectLabel(u) }))]}
              />
            </div>
          ) : (
            <div>
              <label className="label">Unit</label>
              <p className="input bg-slate-50">{unitSelectLabel(units[0])}</p>
            </div>
          )}
          <div>
            <label className="label">Period</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    setPreset(p.key);
                    setRange(presetRange(p.key));
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${preset === p.key ? 'bg-soul-blue text-white ring-soul-blue' : 'bg-white text-slate-600 ring-slate-200 hover:ring-soul-blue/50'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input type="date" className="input" min={FINANCIAL_EPOCH} value={range.from} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, from: e.target.value })); }} aria-label="From" />
              <input type="date" className="input" value={range.to} onChange={(e) => { setPreset('custom'); setRange((r) => ({ ...r, to: e.target.value })); }} aria-label="To" />
            </div>
          </div>
          <button type="button" onClick={generate} disabled={!chosenUnit} className="btn-primary h-11 disabled:opacity-40">
            Show statement
          </button>
        </div>
      </div>

      {requested && isFetching && !data ? <LoadingSpinner /> : null}
      {error ? <div className="card text-sm text-rose-700">{error.response?.data?.error || 'Could not load the statement'}</div> : null}

      {html ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {isStaff ? (
              <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" className="h-4 w-4" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                Internal copy (deductions and company expenses)
              </label>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={print} className="btn-secondary">
                <Printer className="h-4 w-4" /> Print
              </button>
              <button type="button" onClick={downloadPdf} disabled={pdfLoading} className="btn-primary disabled:opacity-60">
                <Download className="h-4 w-4" /> {pdfLoading ? 'Making the PDF…' : 'Download PDF'}
              </button>
            </div>
          </div>
          <iframe ref={frameRef} title="Owner statement" srcDoc={html} onLoad={fitFrame} className="h-[1100px] w-full rounded-2xl border-0 bg-transparent" />
        </div>
      ) : !requested ? (
        <EmptyState icon={FileBarChart2} title="Choose a unit and a period" subtitle="Then press Show statement to see the document the owner receives." />
      ) : null}
    </div>
  );
}
