import { useState } from 'react';
import toast from 'react-hot-toast';
import { FileBarChart, FileSpreadsheet, FileText, Printer, Table2 } from 'lucide-react';
import Modal from './ui/Modal';
import { collectPageReport, exportReport } from '../utils/reportExport';

const FORMATS = [
  { id: 'pdf', label: 'PDF', icon: FileText },
  { id: 'xlsx', label: 'Excel', icon: FileSpreadsheet },
  { id: 'csv', label: 'CSV', icon: Table2 },
  { id: 'print', label: 'Print', icon: Printer },
];

/**
 * "Report" in the header of every admin page: reads the tables and headline figures on screen
 * (with the filters already applied) and saves them as one branded report.
 */
export default function PageReport({ tone = 'light' }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState(null);
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState([]);
  const [withStats, setWithStats] = useState(true);
  const [busy, setBusy] = useState('');

  function start() {
    const found = collectPageReport();
    setReport(found);
    setTitle(found.title);
    setPicked(found.sections.map((_, i) => i));
    setWithStats(found.stats.length > 0);
    setOpen(true);
  }

  async function run(format) {
    if (!report) return;
    const sections = report.sections.filter((_, i) => picked.includes(i));
    if (!sections.length && !(withStats && report.stats.length)) {
      toast.error('Choose at least one table');
      return;
    }
    setBusy(format);
    try {
      const result = await exportReport({ ...report, title: title || report.title, stats: withStats ? report.stats : [], sections }, format);
      if (result === 'printed') toast('The report is long, so it opened for printing. Choose “Save as PDF” there.');
      else if (format !== 'print') toast.success('Report saved');
      setOpen(false);
    } catch (e) {
      toast.error(e?.message === 'image' ? 'Could not draw the report. Try Print.' : 'Could not create the report');
    } finally {
      setBusy('');
    }
  }

  const rowCount = report ? report.sections.filter((_, i) => picked.includes(i)).reduce((s, sec) => s + sec.rows.length, 0) : 0;

  return (
    <>
      <button
        type="button"
        onClick={start}
        className={`p-2 rounded-xl transition-colors flex items-center gap-1.5 ${
          tone === 'dark' ? 'text-blue-100 hover:bg-white/10 hover:text-white' : 'text-soul-muted hover:bg-black/[0.04]'
        }`}
        title="Report of this page"
        aria-label="Report of this page"
      >
        <FileBarChart className="w-5 h-5" />
        <span className="text-sm hidden xl:block">Report</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Report of this page"
        size="md"
        footer={
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
            {FORMATS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                className={id === 'pdf' ? 'btn-primary justify-center' : 'btn-secondary justify-center'}
                disabled={Boolean(busy)}
                onClick={() => run(id)}
              >
                <Icon className="w-4 h-4" /> {busy === id ? '…' : label}
              </button>
            ))}
          </div>
        }
      >
        {report && (
          <div className="space-y-4 text-sm">
            <div>
              <label className="label">Title</label>
              <input className="input w-full" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            {report.meta.length > 0 && (
              <p className="text-xs text-gray-500">
                {report.meta.map((m) => `${m.label}: ${m.value}`).join(' · ')}
              </p>
            )}
            {report.stats.length > 0 && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={withStats} onChange={(e) => setWithStats(e.target.checked)} />
                <span>Headline figures ({report.stats.length})</span>
              </label>
            )}
            {report.sections.length ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Tables on this page</div>
                {report.sections.map((sec, i) => (
                  <label key={i} className="flex items-center justify-between gap-3 rounded-lg border border-soul-line px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked.includes(i)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i] : p.filter((x) => x !== i)))}
                      />
                      <span className="truncate">{sec.title}</span>
                    </span>
                    <span className="shrink-0 text-xs text-gray-500">{sec.rows.length} rows · {sec.columns.length} columns</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                This page has no tables on screen. The report will hold its headline figures; for a full picture use Print.
              </p>
            )}
            <p className="text-xs text-gray-500">
              The report holds what is on screen now, with your filters and search applied{rowCount ? ` (${rowCount} rows)` : ''}.
              For longer periods, widen the filters first.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
