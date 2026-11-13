/**
 * One report format for the whole PMS. A report is a title, a few headline figures and one or more
 * tables. The same report saves as a branded PDF, an Excel workbook (one sheet per table), a CSV,
 * or opens for printing, so any page can hand over exactly what it shows.
 *
 * report = {
 *   title, subtitle, meta: [{ label, value }],
 *   stats: [{ label, value }],
 *   sections: [{ title, columns: [{ label, align: 'right' | 'left' }], rows: [[cell, ...]], totals: [cell, ...] }],
 *   note,
 * }
 * Cells may be strings or numbers; numbers are formatted for PDF and kept numeric in Excel.
 */
import { brandDocument, downloadDocumentPdf, esc, openDocument } from './brandDocument';

const PDF_ROW_LIMIT = 700;

function fmtNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value ?? '';
  return value.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
}

function slug(text) {
  return String(text || 'report').toLowerCase().replace(/[^a-z0-9؀-ۿ]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'report';
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}

export function reportFilename(report, ext) {
  return `soul-${slug(report.title)}-${stamp()}.${ext}`;
}

function isNumericColumn(section, idx) {
  const col = section.columns[idx] || {};
  if (col.align) return col.align === 'right';
  const sample = section.rows.slice(0, 30).map((r) => r[idx]).filter((v) => v !== '' && v != null);
  return sample.length > 0 && sample.every((v) => typeof v === 'number');
}

export function reportHtml(report, { actions = true } = {}) {
  const meta = [...(report.meta || []), { label: 'Generated', value: new Date().toLocaleString('en-GB') }]
    .map((m) => `<div>${esc(m.label)}: <strong style="display:inline;font-size:12px">${esc(m.value)}</strong></div>`)
    .join('');
  const tiles = (report.stats || []).length
    ? `<div class="tiles">${report.stats
        .map((s, i) => `<div class="tile${i === 0 ? ' hero' : ''}"><div class="k">${esc(s.label)}</div><div class="v">${esc(fmtNumber(s.value))}</div></div>`)
        .join('')}</div>`
    : '';
  const sections = (report.sections || [])
    .map((section) => {
      const numeric = section.columns.map((_, i) => isNumericColumn(section, i));
      const head = section.columns.map((c, i) => `<th class="${numeric[i] ? 'num' : ''}">${esc(c.label)}</th>`).join('');
      const body = section.rows.length
        ? section.rows
            .map((row) => `<tr>${section.columns.map((_, i) => {
              const v = row[i];
              const neg = typeof v === 'number' && v < 0;
              return `<td class="${numeric[i] ? 'num' : ''}${neg ? ' neg' : ''}">${esc(fmtNumber(v))}</td>`;
            }).join('')}</tr>`)
            .join('')
        : `<tr><td colspan="${section.columns.length}" class="muted">—</td></tr>`;
      const totals = section.totals
        ? `<tr>${section.columns.map((_, i) => `<td class="${numeric[i] ? 'num' : ''}" style="font-weight:700;border-top:2px solid #cbd5e1">${esc(fmtNumber(section.totals[i] ?? ''))}</td>`).join('')}</tr>`
        : '';
      return `${section.title ? `<h2>${esc(section.title)}</h2>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}${totals}</tbody></table>`;
    })
    .join('');
  const note = report.note ? `<p class="note">${esc(report.note)}</p>` : '';
  const html = brandDocument({
    title: report.title,
    subtitle: report.subtitle || '',
    metaHtml: meta,
    bodyHtml: `${tiles}${sections}${note}`,
    footLeft: '',
    footRight: '',
    actions,
    docTitle: report.title,
  }).replace('</style>', '.foot { display: none !important; } .body { padding-bottom: 28px; }</style>');
  return report.dir === 'rtl' ? html.replace('<html lang="en">', '<html lang="ar" dir="rtl">') : html;
}

export async function exportExcel(report) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const used = new Set();
  const sheetName = (name, i) => {
    let base = String(name || `Table ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 28).trim() || `Table ${i + 1}`;
    let n = base;
    let k = 2;
    while (used.has(n.toLowerCase())) n = `${base.slice(0, 25)} ${k++}`;
    used.add(n.toLowerCase());
    return n;
  };
  const summary = [[report.title], ...(report.subtitle ? [[report.subtitle]] : []), []];
  for (const m of report.meta || []) summary.push([m.label, m.value]);
  if ((report.stats || []).length) {
    summary.push([]);
    for (const s of report.stats) summary.push([s.label, s.value]);
  }
  summary.push([], ['Generated', new Date().toLocaleString('en-GB')]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), sheetName('Summary', 0));
  (report.sections || []).forEach((section, i) => {
    const aoa = [section.columns.map((c) => c.label), ...section.rows];
    if (section.totals) aoa.push(section.totals);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = section.columns.map((c, idx) => ({
      wch: Math.min(48, Math.max(10, String(c.label).length + 2, ...section.rows.slice(0, 200).map((r) => String(r[idx] ?? '').length + 2))),
    }));
    XLSX.utils.book_append_sheet(wb, ws, sheetName(section.title, i + 1));
  });
  XLSX.writeFile(wb, reportFilename(report, 'xlsx'));
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv(report) {
  const lines = [];
  (report.sections || []).forEach((section, i) => {
    if (i > 0) lines.push('');
    if ((report.sections || []).length > 1 && section.title) lines.push(csvCell(section.title));
    lines.push(section.columns.map((c) => csvCell(c.label)).join(','));
    for (const row of section.rows) lines.push(row.map(csvCell).join(','));
    if (section.totals) lines.push(section.totals.map(csvCell).join(','));
  });
  // BOM so Excel opens Arabic text correctly.
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(report, 'csv');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function printReport(report) {
  return openDocument(reportHtml(report, { actions: true }));
}

/** Very long reports print instead: a single drawn PDF has a height limit in the browser. */
export async function exportPdf(report) {
  const rows = (report.sections || []).reduce((s, sec) => s + sec.rows.length, 0);
  if (rows > PDF_ROW_LIMIT) {
    printReport(report);
    return 'printed';
  }
  await downloadDocumentPdf(reportHtml(report, { actions: false }), reportFilename(report, 'pdf'));
  return 'saved';
}

export async function exportReport(report, format) {
  if (format === 'xlsx') return exportExcel(report);
  if (format === 'csv') return exportCsv(report);
  if (format === 'print') return printReport(report);
  return exportPdf(report);
}

/** Text of a cell with buttons, icons and screen-reader-only text removed; numbers come back as numbers. */
function cellValue(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll('button, svg, input, select, textarea, .sr-only, [data-report-skip]').forEach((n) => n.remove());
  const text = clone.textContent.replace(/\s+/g, ' ').trim();
  const numeric = text.replace(/(EGP|USD|ج\.م|\$|£|€)/gi, '').replace(/[,\s ]/g, '');
  // Phone numbers, IDs and references stay text.
  if (/^\+?\d{9,}$/.test(numeric) || /^0\d/.test(numeric)) return text;
  if (/^[-−+]?\d+(\.\d+)?$/.test(numeric) && text.length < 24) return Number(numeric.replace('−', '-'));
  return text;
}

function visible(el) {
  return Boolean(el.offsetParent || el.getClientRects().length);
}

/** The nearest heading above a table: a caption, a card title or the closest heading in its card. */
function tableTitle(table, index) {
  const caption = table.querySelector('caption');
  if (caption?.textContent.trim()) return caption.textContent.trim();
  if (table.dataset.reportTitle) return table.dataset.reportTitle;
  let node = table;
  for (let depth = 0; node && depth < 6; depth++) {
    node = node.parentElement;
    if (!node) break;
    const heading = node.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > div > h2, :scope > div > h3, :scope > header h2, :scope > header h3');
    if (heading && !heading.contains(table) && heading.textContent.trim()) return heading.textContent.trim().slice(0, 80);
  }
  return `Table ${index + 1}`;
}

/** Reads every visible table and headline figure on the current page. */
export function collectPageReport(root = document.querySelector('main') || document.body) {
  const title =
    root.querySelector('[data-report-title]')?.dataset.reportTitle ||
    root.querySelector('h1')?.textContent.trim() ||
    document.title.replace(/\s*[|·-].*$/, '') ||
    'Report';

  const stats = [];
  root.querySelectorAll('[data-report-stat], .stat-card').forEach((card) => {
    if (!visible(card) || stats.length >= 12) return;
    if (card.dataset.reportStat) {
      stats.push({ label: card.dataset.reportStat, value: card.dataset.reportValue ?? cellValue(card) });
      return;
    }
    const texts = [...card.querySelectorAll('p, span, div')].filter((n) => n.children.length === 0).map((n) => n.textContent.trim()).filter(Boolean);
    if (texts.length >= 2) stats.push({ label: texts[0], value: texts[1] });
  });

  const sections = [];
  [...root.querySelectorAll('table')].filter(visible).forEach((table, index) => {
    const headerRow = table.tHead?.rows[table.tHead.rows.length - 1] || table.rows[0];
    if (!headerRow) return;
    const headCells = [...headerRow.cells];
    const bodyRows = [...(table.tBodies[0]?.rows || [])].filter((tr) => visible(tr) && tr !== headerRow);
    if (!bodyRows.length) return;
    const data = bodyRows
      .map((tr) => [...tr.cells].map(cellValue))
      .filter((cells) => cells.some((c) => c !== ''));
    // Drop columns with no header and no text (action buttons).
    const keep = headCells
      .map((th, i) => ({ i, label: cellValue(th) || '', span: th.colSpan || 1 }))
      .filter(({ i, label }) => label !== '' || data.some((r) => r[i] !== '' && r[i] != null));
    const columns = keep.map(({ label }, k) => ({ label: String(label || `Column ${k + 1}`) }));
    const rows = data.map((r) => keep.map(({ i }) => r[i] ?? ''));
    let totals;
    const foot = table.tFoot?.rows[0];
    if (foot) {
      const cells = [...foot.cells].map(cellValue);
      totals = keep.map(({ i }) => cells[i] ?? '');
    }
    sections.push({ title: tableTitle(table, index), columns, rows, totals });
  });

  // A page with one unnamed table: the table is the page.
  if (sections.length === 1 && /^Table \d+$/.test(sections[0].title)) sections[0].title = String(title).trim();
  sections.forEach((s, i) => {
    if (/^Table \d+$/.test(s.title)) s.title = `${String(title).trim()} (${i + 1})`;
  });

  const filters = [...root.querySelectorAll('input[type="date"]')]
    .filter((i) => visible(i) && i.value)
    .map((i) => i.value);
  const meta = [];
  if (filters.length >= 2) meta.push({ label: 'Period', value: `${filters[0]} → ${filters[1]}` });
  else if (filters.length === 1) meta.push({ label: 'Date', value: filters[0] });
  const search = [...root.querySelectorAll('input[type="search"], input[placeholder*="earch"]')].find((i) => visible(i) && i.value);
  if (search) meta.push({ label: 'Filter', value: search.value });

  return {
    title,
    subtitle: window.location.pathname.replace('/admin/', '').replace(/\//g, ' › ') || '',
    meta,
    stats,
    sections,
    dir: document.documentElement.dir === 'rtl' || root.closest('[dir="rtl"]') || root.querySelector('[dir="rtl"]') ? 'rtl' : 'ltr',
  };
}
