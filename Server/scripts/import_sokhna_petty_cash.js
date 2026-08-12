/**
 * Import Sokhna petty cash Excel into location=sokhna only (does not touch North Coast).
 *
 * Usage:
 *   node scripts/import_sokhna_petty_cash.js "C:/Users/hazem/Downloads/Petty Cash Sokhna.xlsx"
 *   node scripts/import_sokhna_petty_cash.js --dry-run "..."
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { query, pool } = require('../src/config/db');

const LOCATION = 'sokhna';
const DRY = process.argv.includes('--dry-run');
const fileArg = process.argv.find((a) => !a.startsWith('-') && a.endsWith('.xlsx'));
const FILE =
  fileArg ||
  path.join(process.env.USERPROFILE || '', 'Downloads', 'Petty Cash Sokhna.xlsx');

function excelSerialToIso(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

function parseEntryDate(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell) && cell > 20000) {
    return excelSerialToIso(cell);
  }
  const s = String(cell).trim();
  const m = s.match(/^(\d{1,2})[\\/.\-](\d{1,2})[\\/.\-](\d{2,4})$/);
  if (!m) return null;
  let day = Number(m[1]);
  let month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (year < 2020 || year > 2030) year = 2026;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normUnit(code) {
  let s = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
  // Common OCR / typing: GO1 → G01
  s = s.replace(/GO(\d)/g, 'G0$1');
  // Strip trailing Arabic / non-code junk glued on
  s = s.replace(/[\u0600-\u06FF].*$/g, '');
  s = s.replace(/(CHECKIN|سنوي|عقد).*$/i, '');
  return s;
}

/** Looks like a unit code rather than Arabic notes jammed into the Units column. */
function looksLikeUnitCode(code) {
  const s = normUnit(code);
  if (!s || s.length < 3) return false;
  if (!/[A-Z]/.test(s) || !/\d/.test(s)) return false;
  if (/^(SOUL|TATWER|PORTO|ID|SHAHEEN)/i.test(s)) return false;
  return true;
}

/** Extract primary unit code from cells like "C1-CH20-02-02 / CH-161-01-04" or "50-49-50 ( Soul )". */
function extractUnitCodes(raw) {
  if (raw == null || raw === '') return [];
  let s = String(raw).trim();
  s = s.replace(/\([^)]*\)/g, ' ');
  const parts = s
    .split(/\s*\/\s*|\s*,\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return [...new Set(parts.map(normUnit).filter(looksLikeUnitCode))];
}

function looksOwnerCost(desc, notes) {
  const s = `${desc || ''} ${notes || ''}`.toLowerCase();
  return (
    /\bowner\b/.test(s) ||
    /3la\s*el\s*owner/.test(s) ||
    /el\s*owner/.test(s) ||
    /المالك/.test(s) ||
    /اونر/.test(s) ||
    /على\s*الاونر/.test(s)
  );
}

function buildDescription(desc, notes, category) {
  const d = String(desc || '').trim();
  const n = String(notes || '').trim();
  const c = String(category || '').trim();
  const base = d && n && n !== d ? `${d} · ${n}` : d || n || 'Petty cash';
  if (c && !base.toLowerCase().includes(c.toLowerCase())) return `[${c}] ${base}`;
  return base;
}

(async () => {
  console.log(`[sokhna-petty] file=${FILE} dry=${DRY} location=${LOCATION}`);

  const wb = XLSX.readFile(FILE);
  const sheetName =
    wb.SheetNames.find((n) => /^petty cash$/i.test(String(n).trim())) || wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  });

  let openingBalance = 0;
  let lastDate = null;
  const entries = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || !r.length) continue;
    const dateCell = r[0];
    const unitRaw = r[1];
    const costTag = r[2];
    const desc = r[3];
    const payment = r[4];
    const cashIn = Number(r[5]) || 0;
    const cashOut = Number(r[6]) || 0;
    const bal = r[7];
    const notes = r[8];

    if (String(dateCell || '').toUpperCase().includes('BEGINNING')) {
      if (!openingBalance && Number(bal) > 0) openingBalance = Number(bal);
      continue;
    }

    if (cashIn <= 0 && cashOut <= 0) continue;
    if (!desc && !notes) continue;

    const entryType = cashIn > 0 ? 'in' : 'out';
    const amount = entryType === 'in' ? cashIn : cashOut;
    let entryDate = parseEntryDate(dateCell);
    if (!entryDate && lastDate) entryDate = lastDate;
    if (!entryDate) {
      console.warn(`[skip] bad date row=${i + 1}`, dateCell, desc);
      continue;
    }
    lastDate = entryDate;

    const unitCodes = extractUnitCodes(unitRaw);
    // If Units No. cell is notes (not a code), fold into description
    const unitLooksLikeNotes =
      unitRaw &&
      !unitCodes.length &&
      /[\u0600-\u06FF]/.test(String(unitRaw));
    const extraNote = unitLooksLikeNotes ? String(unitRaw).trim() : null;

    entries.push({
      entryDate,
      unitCodes,
      costTag: costTag ? String(costTag).trim() : null,
      description: buildDescription(desc, [notes, extraNote].filter(Boolean).join(' · '), costTag),
      amount,
      entryType,
      paidBy: entryType === 'out' && looksOwnerCost(desc, notes) ? 'owner' : 'company',
      notes: [
        costTag ? `Category: ${String(costTag).trim()}` : null,
        payment ? `Payment: ${String(payment).trim()}` : null,
        notes ? String(notes).trim() : null,
        unitCodes.length > 1 ? `Units: ${unitCodes.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    });
  }

  console.log(`[sokhna-petty] parsed entries=${entries.length} opening=${openingBalance}`);

  const { rows: units } = await query(`SELECT id, unit_number FROM units`);
  const unitByCode = new Map();
  for (const u of units) {
    const code = normUnit(u.unit_number);
    if (code) unitByCode.set(code, u.id);
  }

  const { rows: ownerLinks } = await query(
    `SELECT unit_id, owner_id FROM owner_units ORDER BY owner_id`
  );
  const ownerByUnit = new Map();
  for (const l of ownerLinks) {
    if (!ownerByUnit.has(l.unit_id)) ownerByUnit.set(l.unit_id, l.owner_id);
  }

  const { rows: admins } = await query(
    `SELECT id FROM staff_users
     WHERE role = 'admin' AND COALESCE(is_active, 1) = 1
     ORDER BY id LIMIT 1`
  );
  const createdBy = admins[0]?.id;
  if (!createdBy) throw new Error('No active admin user for created_by');

  let matched = 0;
  let unmatched = 0;
  const unmatchedCodes = new Set();
  for (const e of entries) {
    e.unitId = null;
    for (const code of e.unitCodes || []) {
      const id = unitByCode.get(code);
      if (id) {
        e.unitId = id;
        matched += 1;
        break;
      }
      unmatchedCodes.add(code);
    }
    if ((e.unitCodes || []).length && !e.unitId) unmatched += 1;
    if (e.paidBy === 'owner' && e.unitId) e.ownerId = ownerByUnit.get(e.unitId) || null;
    if (e.paidBy === 'owner' && !e.ownerId) e.paidBy = 'company';
  }

  console.log(
    JSON.stringify(
      {
        matchedUnitRows: matched,
        unmatchedUnitRows: unmatched,
        unmatchedCodes: [...unmatchedCodes].sort(),
        ownerTagged: entries.filter((e) => e.paidBy === 'owner').length,
        cashIn: entries.filter((e) => e.entryType === 'in').length,
        cashOut: entries.filter((e) => e.entryType === 'out').length,
      },
      null,
      2
    )
  );

  if (DRY) {
    console.log('[sokhna-petty] dry-run only — no DB writes');
    await pool.end();
    return;
  }

  await query('BEGIN');
  try {
    await query(
      `UPDATE petty_cash
       SET linked_expense_id = NULL, linked_reservation_id = NULL
       WHERE location = $1`,
      [LOCATION]
    );
    const del = await query(`DELETE FROM petty_cash WHERE location = $1 RETURNING id`, [
      LOCATION,
    ]);
    console.log(`[sokhna-petty] deleted sokhna=${del.rowCount}`);

    let inserted = 0;
    for (const e of entries) {
      await query(
        `INSERT INTO petty_cash (
           location, description, amount, entry_type, entry_date, created_by,
           unit_id, paid_by, notes, status, is_advance, owner_id
         ) VALUES (
           $1,$2,$3,$4,$5::date,$6,
           $7,$8,$9,'open',0,$10
         )`,
        [
          LOCATION,
          e.description,
          e.amount,
          e.entryType,
          e.entryDate,
          createdBy,
          e.unitId,
          e.paidBy,
          e.notes,
          e.ownerId || null,
        ]
      );
      inserted += 1;
    }

    await query(
      `INSERT INTO petty_cash_settings (location, opening_balance, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (location) DO UPDATE
         SET opening_balance = EXCLUDED.opening_balance, updated_at = now()`,
      [LOCATION, openingBalance || 0]
    );

    await query('COMMIT');

    const after = (
      await query(`
        SELECT location, entry_type, count(*)::int AS n, coalesce(sum(amount),0)::float AS total
        FROM petty_cash GROUP BY 1,2 ORDER BY 1,2
      `)
    ).rows;
    console.log(JSON.stringify({ inserted, openingBalance, after }, null, 2));
  } catch (e) {
    await query('ROLLBACK');
    throw e;
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
