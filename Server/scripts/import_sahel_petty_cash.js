/**
 * Wipe all petty_cash and import Sahel 2026 Excel (North Coast).
 *
 * Usage:
 *   node scripts/import_sahel_petty_cash.js "C:/Users/hazem/Downloads/Petty Cash - Sahel 2026 (1).xlsx"
 *   node scripts/import_sahel_petty_cash.js --dry-run "..."
 */
require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { query, pool } = require('../src/config/db');

const LOCATION = 'north_coast';
const DRY = process.argv.includes('--dry-run');
const fileArg = process.argv.find((a) => !a.startsWith('-') && a.endsWith('.xlsx'));
const FILE =
  fileArg ||
  path.join(
    process.env.USERPROFILE || '',
    'Downloads',
    'Petty Cash - Sahel 2026 (1).xlsx'
  );

function excelSerialToIso(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  // Excel epoch 1899-12-30 (with Lotus 1900 leap bug)
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Parse Excel date cell: serial number or d/m/yyyy text (also \, -, .). */
function parseEntryDate(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number' && Number.isFinite(cell)) {
    // Guard against tiny numbers that aren't real Excel serials
    if (cell > 20000) return excelSerialToIso(cell);
  }
  const s = String(cell).trim();
  const m = s.match(/^(\d{1,2})[\\/.\-](\d{1,2})[\\/.\-](\d{2,4})$/);
  if (!m) return null;
  let day = Number(m[1]);
  let month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  // File is Sahel 2026 — fix corrupted years (2137, 2165, …)
  if (year < 2020 || year > 2030) year = 2026;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normUnit(code) {
  return String(code || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/_/g, '-');
}

function looksOwnerCost(desc, notes) {
  const s = `${desc || ''} ${notes || ''}`.toLowerCase();
  return (
    /\bowner\b/.test(s) ||
    /3la\s*el\s*owner/.test(s) ||
    /el\s*owner/.test(s) ||
    /اونر/.test(s) ||
    /على\s*الاونر/.test(s)
  );
}

function buildDescription(desc, notes) {
  const d = String(desc || '').trim();
  const n = String(notes || '').trim();
  if (d && n && n !== d) return `${d} · ${n}`;
  return d || n || 'Petty cash';
}

(async () => {
  console.log(`[petty-import] file=${FILE} dry=${DRY} location=${LOCATION}`);

  const wb = XLSX.readFile(FILE);
  const sheetName =
    wb.SheetNames.find((n) => /^petty cash$/i.test(String(n).trim())) ||
    wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  });

  let openingBalance = 0;
  const entries = [];
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r || !r.length) continue;
    const dateCell = r[0];
    const unitRaw = r[1];
    const costTag = r[2];
    const desc = r[3];
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
    const entryDate = parseEntryDate(dateCell);
    if (!entryDate) {
      console.warn(`[skip] bad date row=${i + 1}`, dateCell, desc);
      continue;
    }

    entries.push({
      entryDate,
      unitCode: unitRaw ? normUnit(unitRaw) : null,
      costTag: costTag ? String(costTag).trim() : null,
      description: buildDescription(desc, notes),
      amount,
      entryType,
      paidBy: entryType === 'out' && looksOwnerCost(desc, notes) ? 'owner' : 'company',
      notes: [costTag ? `Handler: ${String(costTag).trim()}` : null, notes ? String(notes).trim() : null]
        .filter(Boolean)
        .join(' · ') || null,
    });
  }

  console.log(`[petty-import] parsed entries=${entries.length} opening=${openingBalance}`);

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
     WHERE role = 'admin'
       AND COALESCE(is_active, 1) = 1
     ORDER BY id
     LIMIT 1`
  );
  const createdBy = admins[0]?.id;
  if (!createdBy) throw new Error('No active admin user for created_by');

  let matched = 0;
  let unmatched = 0;
  const unmatchedCodes = new Set();
  for (const e of entries) {
    if (!e.unitCode) continue;
    const id = unitByCode.get(e.unitCode);
    if (id) {
      e.unitId = id;
      matched += 1;
      if (e.paidBy === 'owner') e.ownerId = ownerByUnit.get(id) || null;
    } else {
      unmatched += 1;
      unmatchedCodes.add(e.unitCode);
      e.unitId = null;
      // Can't attribute to owner without a unit link
      if (e.paidBy === 'owner') e.paidBy = 'company';
    }
  }

  console.log(
    JSON.stringify(
      {
        matchedUnits: matched,
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
    console.log('[petty-import] dry-run only — no DB writes');
    await pool.end();
    return;
  }

  await query('BEGIN');
  try {
    // Clear links that may block delete, then wipe all petty cash.
    await query(`UPDATE petty_cash SET linked_expense_id = NULL, linked_reservation_id = NULL`);
    const del = await query(`DELETE FROM petty_cash RETURNING id`);
    console.log(`[petty-import] deleted=${del.rowCount}`);

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
    // Sokhna wiped with the rest — reset opening balance
    await query(
      `INSERT INTO petty_cash_settings (location, opening_balance, updated_at)
       VALUES ('sokhna', 0, now())
       ON CONFLICT (location) DO UPDATE
         SET opening_balance = 0, updated_at = now()`
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
