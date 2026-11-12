import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { currency } from '../../utils/formatters';
import { useFinLocale } from '../../context/FinLocaleContext';

/**
 * Search and Excel export for a table written by hand (statements, tax, owner reports).
 * Search hides non-matching body rows; export saves exactly what is on screen.
 */
export function SmartTable({ name = 'table', children }) {
  const { t } = useFinLocale();
  const box = useRef(null);
  const [q, setQ] = useState('');
  const [count, setCount] = useState(null);

  useEffect(() => {
    const table = box.current?.querySelector('table');
    if (!table) return;
    const needle = q.trim().toLowerCase();
    let shown = 0;
    for (const tr of table.querySelectorAll('tbody > tr')) {
      const hit = !needle || tr.textContent.toLowerCase().includes(needle);
      tr.style.display = hit ? '' : 'none';
      if (hit) shown += 1;
    }
    setCount(shown);
  });

  async function exportExcel() {
    try {
      const table = box.current?.querySelector('table');
      if (!table) return;
      const XLSX = await import('xlsx');
      const wb = XLSX.utils.table_to_book(table, { raw: false });
      XLSX.writeFile(wb, `${name}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      toast.error(t('pms.fin.table.exportFailed'));
    }
  }

  return (
    <div ref={box}>
      <div className="flex flex-wrap items-center gap-2 border-b border-soul-line px-3 py-2">
        <label className="relative min-w-[160px] flex-1 max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input className="input w-full py-1 ps-7 text-xs" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('pms.fin.table.search')} />
        </label>
        <span className="ms-auto text-xs text-gray-400 tabular-nums">{count != null ? t('pms.fin.table.rows', { count }) : ''}</span>
        <button type="button" className="btn-secondary !px-2.5 !py-1 text-xs" onClick={exportExcel}>
          <Download className="h-3.5 w-3.5" /> {t('pms.fin.table.export')}
        </button>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

/**
 * One table for every Financial System list: search, sort, filter chips, totals, Excel export,
 * and optional row selection with bulk actions.
 *
 * columns: [{ key, label, value?(row), render?(row), align?: 'end', money?: bool, total?: bool, nowrap?: bool }]
 * filters: [{ id, label, test(row) }]  bulkActions: [{ label, onRun(rows), tone?: 'primary' }]
 */
export default function DataTable({
  columns,
  rows = [],
  rowKey = (r) => r.id,
  exportName = 'export',
  filters = [],
  bulkActions = [],
  onRowClick,
  emptyText,
  initialSort = null,
  searchPlaceholder,
  dense = false,
  toolbarExtra = null,
}) {
  const { t } = useFinLocale();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort);
  const [filterId, setFilterId] = useState('');
  const [picked, setPicked] = useState(() => new Set());

  const valueOf = (col, row) => (col.value ? col.value(row) : row[col.key]);

  const shown = useMemo(() => {
    let list = rows;
    const f = filters.find((x) => x.id === filterId);
    if (f) list = list.filter(f.test);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((row) =>
        columns.some((c) => {
          const v = valueOf(c, row);
          return v != null && String(v).toLowerCase().includes(needle);
        })
      );
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        const dir = sort.dir === 'desc' ? -1 : 1;
        list = [...list].sort((a, b) => {
          const x = valueOf(col, a);
          const y = valueOf(col, b);
          if (x == null && y == null) return 0;
          if (x == null) return 1;
          if (y == null) return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
          return String(x).localeCompare(String(y), undefined, { numeric: true }) * dir;
        });
      }
    }
    return list;
  }, [rows, columns, q, sort, filterId, filters]);

  const totals = useMemo(() => {
    const out = {};
    for (const c of columns) {
      if (!c.total) continue;
      out[c.key] = shown.reduce((s, r) => s + (Number(valueOf(c, r)) || 0), 0);
    }
    return out;
  }, [shown, columns]);
  const hasTotals = Object.keys(totals).length > 0;

  const selectable = bulkActions.length > 0;
  const pickedRows = shown.filter((r) => picked.has(rowKey(r)));
  const allPicked = selectable && shown.length > 0 && pickedRows.length === shown.length;

  function toggleSort(key) {
    setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }
  function togglePick(key) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function exportExcel() {
    try {
      const XLSX = await import('xlsx');
      const data = shown.map((r) => Object.fromEntries(columns.filter((c) => !c.noExport).map((c) => [c.label, valueOf(c, r) ?? ''])));
      if (hasTotals) data.push(Object.fromEntries(columns.filter((c) => !c.noExport).map((c, i) => [c.label, c.total ? totals[c.key] : i === 0 ? t('pms.fin.table.total') : ''])));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, `${exportName}-${new Date().toISOString().slice(0, 10)}.xlsx`);
    } catch {
      toast.error(t('pms.fin.table.exportFailed'));
    }
  }

  const cell = dense ? 'px-3 py-2' : 'px-4 py-2.5';
  const fmt = (c, v) => (c.money ? currency(v || 0) : v);

  return (
    <div className="rounded-2xl border border-soul-line bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-soul-line px-3 py-2.5">
        <label className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            className="input w-full py-1.5 ps-8 text-sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={searchPlaceholder || t('pms.fin.table.search')}
          />
        </label>
        {filters.length ? (
          <div className="flex flex-wrap gap-1">
            {[{ id: '', label: t('pms.fin.table.all') }, ...filters].map((f) => {
              const n = f.id ? rows.filter(f.test).length : rows.length;
              return (
                <button
                  key={f.id || 'all'}
                  type="button"
                  onClick={() => setFilterId(f.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${filterId === f.id ? 'bg-soul-blue text-white' : 'bg-slate-100 text-gray-600 hover:bg-slate-200'}`}
                >
                  {f.label} <span className="opacity-70 tabular-nums">{n}</span>
                </button>
              );
            })}
          </div>
        ) : null}
        <div className="ms-auto flex items-center gap-2">
          {toolbarExtra}
          <span className="text-xs text-gray-400 tabular-nums">{t('pms.fin.table.rows', { count: shown.length })}</span>
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={exportExcel} disabled={!shown.length}>
            <Download className="h-3.5 w-3.5" /> {t('pms.fin.table.export')}
          </button>
        </div>
      </div>

      {selectable && pickedRows.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-soul-line bg-soul-blue-50/60 px-3 py-2 text-sm">
          <span className="font-semibold text-soul-blue">{t('pms.fin.table.selected', { count: pickedRows.length })}</span>
          {bulkActions.map((a) => (
            <button
              key={a.label}
              type="button"
              className={`${a.tone === 'primary' ? 'btn-primary' : 'btn-secondary'} !px-3 !py-1 text-xs`}
              onClick={async () => {
                await a.onRun(pickedRows);
                setPicked(new Set());
              }}
            >
              {a.label}
            </button>
          ))}
          <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => setPicked(new Set())}>
            {t('pms.fin.table.clear')}
          </button>
        </div>
      ) : null}

      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-slate-50 text-[11px] uppercase tracking-wide text-gray-500">
            <tr>
              {selectable ? (
                <th className={`${cell} w-8`}>
                  <input
                    type="checkbox"
                    aria-label={t('pms.fin.table.selectAll')}
                    checked={allPicked}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map(rowKey)))}
                  />
                </th>
              ) : null}
              {columns.map((c) => (
                <th key={c.key} className={`${cell} font-semibold ${c.align === 'end' ? 'text-end' : 'text-start'} whitespace-nowrap`}>
                  {c.sortable === false ? (
                    c.label
                  ) : (
                    <button type="button" className="inline-flex items-center gap-1 hover:text-soul-blue" onClick={() => toggleSort(c.key)}>
                      {c.label}
                      {sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : null}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length ? (
              shown.map((r) => {
                const key = rowKey(r);
                return (
                  <tr
                    key={key}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={`border-t border-soul-line/70 ${onRowClick ? 'cursor-pointer hover:bg-soul-blue-50/40' : ''} ${picked.has(key) ? 'bg-soul-blue-50/50' : ''}`}
                  >
                    {selectable ? (
                      <td className={cell} onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={picked.has(key)} onChange={() => togglePick(key)} aria-label={t('pms.fin.table.selectRow')} />
                      </td>
                    ) : null}
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={`${cell} align-top ${c.align === 'end' ? 'text-end tabular-nums whitespace-nowrap' : ''} ${c.nowrap ? 'whitespace-nowrap' : ''}`}
                      >
                        {c.render ? c.render(r) : fmt(c, valueOf(c, r))}
                      </td>
                    ))}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-10 text-center text-sm text-gray-400">
                  {emptyText || t('pms.fin.table.empty')}
                </td>
              </tr>
            )}
          </tbody>
          {hasTotals && shown.length ? (
            <tfoot className="sticky bottom-0 bg-slate-50 font-semibold">
              <tr className="border-t border-soul-line">
                {selectable ? <td className={cell} /> : null}
                {columns.map((c, i) => (
                  <td key={c.key} className={`${cell} ${c.align === 'end' ? 'text-end tabular-nums whitespace-nowrap' : ''}`}>
                    {c.total ? currency(totals[c.key]) : i === 0 ? t('pms.fin.table.total') : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}
