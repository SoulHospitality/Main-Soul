/**
 * One printed-document design for the owner statement and the reservation receipt:
 * a navy letterhead, a summary strip, clean tables and a footer. Rendered as a full HTML page so
 * the same markup shows in the app (iframe) and in the print / Save-as-PDF window.
 */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLES = `
  :root { color-scheme: light; --ink: #14213d; --muted: #64748b; --line: #e2e8f0; --navy: #0b2f4a; --sea: #0b4f73; --sand: #f6f1e7; --good: #047857; --bad: #b91c1c; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #eef2f6; }
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--ink); padding: 24px 12px; }
  .sheet { max-width: 820px; margin: 0 auto; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 10px 40px rgba(15, 23, 42, 0.12); }
  .head { background: linear-gradient(120deg, var(--navy), var(--sea)); color: #fff; padding: 28px 36px 24px; display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand img { height: 34px; width: auto; filter: brightness(0) invert(1); }
  .brand .name { font-size: 13px; letter-spacing: 0.22em; text-transform: uppercase; opacity: 0.85; }
  .doc-title { margin: 18px 0 0; font-size: 26px; font-weight: 600; letter-spacing: -0.01em; }
  .doc-sub { margin: 4px 0 0; font-size: 13px; opacity: 0.8; }
  .meta { text-align: right; font-size: 12px; line-height: 1.7; opacity: 0.92; }
  .meta strong { display: block; font-size: 15px; letter-spacing: 0.02em; opacity: 1; }
  .body { padding: 28px 36px 8px; }
  .parties { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px 28px; padding-bottom: 22px; border-bottom: 1px solid var(--line); }
  .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
  .v { margin-top: 3px; font-size: 14px; font-weight: 600; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 22px 0 6px; }
  .tile { background: var(--sand); border-radius: 10px; padding: 12px 14px; }
  .tile .v { font-size: 15px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .tile.hero { background: var(--navy); color: #fff; }
  .tile.hero .k { color: rgba(255,255,255,0.7); }
  h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--muted); margin: 28px 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th, td { padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
  th { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); font-weight: 600; background: #f8fafc; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.center, th.center { text-align: center; }
  .neg { color: var(--bad); }
  .pos { color: var(--good); }
  .muted { color: #94a3b8; font-style: italic; }
  .pill { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 10.5px; font-weight: 600; background: #e2e8f0; color: #334155; }
  .pill.owner { background: #fef3c7; color: #92400e; }
  .pill.ok { background: #d1fae5; color: #065f46; }
  .sum { margin: 18px 0 0 auto; max-width: 360px; font-size: 13px; }
  .sum .row { display: flex; justify-content: space-between; gap: 18px; padding: 6px 0; }
  .sum .row span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
  .sum .rule { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 10px; }
  .sum .grand { margin-top: 10px; background: var(--navy); color: #fff; border-radius: 10px; padding: 12px 14px; font-size: 15px; }
  .note { margin-top: 18px; font-size: 11.5px; color: var(--muted); line-height: 1.6; }
  .foot { margin-top: 30px; padding: 16px 36px 24px; border-top: 1px dashed #cbd5e1; display: flex; justify-content: space-between; gap: 16px; font-size: 11px; color: var(--muted); }
  .actions { max-width: 820px; margin: 0 auto 14px; display: flex; gap: 8px; }
  .actions button { border: 1px solid #cbd5e1; background: var(--navy); color: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  .actions button.secondary { background: #fff; color: var(--ink); }
  @media (max-width: 600px) {
    .head { flex-direction: column; padding: 22px 20px; }
    .meta { text-align: left; }
    .body { padding: 22px 20px 6px; }
    .foot { padding: 14px 20px 20px; flex-direction: column; }
    table { font-size: 11.5px; }
  }
  @media print {
    html, body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; border-radius: 0; max-width: none; }
    .actions { display: none !important; }
    .head { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .tile, .sum .grand, th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    tr { page-break-inside: avoid; }
  }
`;

/**
 * Full HTML page.
 * opts: { title, subtitle, metaHtml, bodyHtml, footLeft, footRight, actions: true|false, docTitle }
 */
export function brandDocument({ title, subtitle = '', metaHtml = '', bodyHtml = '', footLeft = '', footRight = '', actions = true, docTitle }) {
  const logo = `${window.location.origin}/soul-brand/soul-logo.png`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(docTitle || title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  ${actions ? `<div class="actions">
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
    <button type="button" class="secondary" onclick="window.close()">Close</button>
  </div>` : ''}
  <div class="sheet">
    <div class="head">
      <div>
        <div class="brand"><img src="${esc(logo)}" alt="" onerror="this.style.display='none'" /><span class="name">Soul Hospitality</span></div>
        <h1 class="doc-title">${esc(title)}</h1>
        ${subtitle ? `<p class="doc-sub">${esc(subtitle)}</p>` : ''}
      </div>
      <div class="meta">${metaHtml}</div>
    </div>
    <div class="body">${bodyHtml}</div>
    <div class="foot"><span>${footLeft}</span><span>${footRight}</span></div>
  </div>
</body>
</html>`;
}

/** Open a document in a new window for printing. Returns false when pop-ups are blocked. */
export function openDocument(html) {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  return true;
}

const PDF_CSS = `
  html, body { background: #fff !important; padding: 0 !important; margin: 0 !important; }
  .sheet { box-shadow: none !important; border-radius: 0 !important; max-width: none !important; width: 820px !important; }
  .actions { display: none !important; }
`;

async function toDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('image');
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Saves a branded document as a real PDF file, made in the browser so Arabic names render correctly.
 * The page is laid out off-screen, drawn to a canvas, and cut into A4 pages between rows (never through one).
 */
export async function downloadDocumentPdf(html, filename) {
  const { jsPDF } = await import('jspdf');
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '820px', height: '1200px', border: '0' });
  document.body.appendChild(frame);
  try {
    await new Promise((resolve) => {
      frame.onload = resolve;
      frame.srcdoc = html.replace('</style>', `${PDF_CSS}</style>`);
    });
    const doc = frame.contentDocument;
    if (doc.fonts?.ready) await doc.fonts.ready;
    // Images must be inline for the drawing step.
    for (const img of doc.querySelectorAll('img')) {
      try {
        img.src = await toDataUrl(img.src);
        await img.decode().catch(() => {});
      } catch {
        img.remove();
      }
    }
    const sheet = doc.querySelector('.sheet');
    const width = Math.ceil(sheet.offsetWidth);
    const height = Math.ceil(sheet.scrollHeight);

    // Where a page may end: just below a row, a tile, a heading block… never through one.
    const top0 = sheet.getBoundingClientRect().top;
    const blocks = [...sheet.querySelectorAll('tr, .tile, .parties > div, h2, .sum .row, .note, .foot, .head, .doc-title')]
      .map((el) => {
        const r = el.getBoundingClientRect();
        return [r.top - top0, r.bottom - top0];
      });

    const style = doc.querySelector('style').textContent.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const body = new XMLSerializer().serializeToString(sheet);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject x="0" y="0" width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;background:#fff;color:#14213d;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif"><style>${style}</style>${body}</div>
      </foreignObject></svg>`;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const pxPerPage = Math.floor((pageH / pageW) * width);
    let y = 0;
    let first = true;
    while (y < height - 1) {
      let end = Math.min(height, y + pxPerPage);
      if (end < height) {
        // Move the cut up above any block it would split.
        for (const [a, b] of blocks) if (a < end && b > end && a > y + 40) end = Math.min(end, Math.floor(a) - 2);
      }
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = Math.ceil((end - y) * scale);
      const sctx = slice.getContext('2d');
      sctx.fillStyle = '#fff';
      sctx.fillRect(0, 0, slice.width, slice.height);
      sctx.drawImage(canvas, 0, y * scale, canvas.width, slice.height, 0, 0, slice.width, slice.height);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, ((end - y) / width) * pageW);
      first = false;
      y = end;
    }
    pdf.save(filename);
    return true;
  } finally {
    frame.remove();
  }
}
