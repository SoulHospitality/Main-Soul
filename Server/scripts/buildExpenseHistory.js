/**
 * Builds src/lib/finance/expenseHistory.json from the treasury and petty cash workbooks.
 * Only money paid out is read; it is grouped into expense categories by its cost label.
 * Usage: node scripts/buildExpenseHistory.js <Tresury.xlsx> <Petty Cash.xlsx>
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const [treasuryFile, pettyFile] = process.argv.slice(2);
if (!treasuryFile || !pettyFile) {
  console.error('Usage: node scripts/buildExpenseHistory.js <Tresury.xlsx> <Petty Cash.xlsx>');
  process.exit(1);
}

const CATEGORIES = [
  { key: 'salaries', label: 'Salaries & bonuses', test: /salar|مرتب|رواتب|bonus|bouns|مكافأ/i },
  { key: 'commissions', label: 'Commissions', test: /commission|comission|عمول|كوميشن/i },
  { key: 'tax', label: 'Tax', test: /\btax|ضرائب|ضرايب|\bvat\b/i },
  { key: 'marketing', label: 'Marketing', test: /campign|campaign|dubizzle|property finder|marketing|advertis|\bmeta\b|دوبيزل/i },
  { key: 'rent', label: 'Rent', test: /\brent|ايجار|إيجار/i },
  {
    key: 'utilities',
    label: 'Utilities, internet & phone',
    test: /elec|eelc|sweedy|seweedy|water|ميه|مياه|كهرب|internet|wi-?fi|(^|\s)نت(\s|$)|home ?4g|triple play|land ?line|\bline\b|vodafone|\bbill|فاتور|انبوب|غاز/i,
  },
  { key: 'housekeeping', label: 'Housekeeping & laundry', test: /house ?keeping|landry|landray|laundry|مغسل|hospitality/i },
  { key: 'beach', label: 'Beach passes & access cards', test: /beach|كروت|بحر|access/i },
  { key: 'uniform', label: 'Uniforms', test: /uniform|يونيفورم/i },
  {
    key: 'stock',
    label: 'Stock, furniture & supplies',
    test: /stock|melyat|ملايات|شراء|مستلزمات|بطاريات|furniture|coverlet|fabric|\btv\b|اثاث/i,
  },
  { key: 'transport', label: 'Transport & cars', test: /بنزين|\bcar\b|سواق|زيت|نقل|transport|scooter|اسكوتر/i },
  { key: 'maintenance', label: 'Maintenance', test: /maint|صيان|تكيف|تكييف|air condition|الرش/i },
  { key: 'charity', label: 'Charity', test: /sadaq|صدق|charity|chairty|kafala/i },
  {
    key: 'general',
    label: 'General & administration',
    test: /general|administrative|office|\bid\b|bank fee|fees bank|event|expenses|buffet|coffee|soap|website|portal/i,
  },
];

// Money out that is not an operating expense.
const EXCLUDED = [
  { key: 'petty_topups', label: 'Petty cash top-ups (counted as petty spending instead)', test: /petty ?cash|عهد/i },
  { key: 'refunds', label: 'Guest refunds and cancellations', test: /refund|cancel|رد /i },
  { key: 'advances', label: 'Advances and loans', test: /advance|سلف/i },
  { key: 'assets', label: 'Asset purchases', test: /buy car/i },
  { key: 'withdrawals', label: 'Cash withdrawals', test: /withdr/i },
  {
    key: 'partners',
    label: 'Partner transfers',
    test: /transfer|\bmr\b|abdel|abdallah|adallah|akram|youssef|shaheen|شاهين|amin home/i,
  },
  {
    key: 'deals',
    label: 'Developers, deals and resale',
    test: /tatweer|madar|madeint|madint|haceinda|hacienda|هاسيندا|royal|eoi|resale|cred ?-?p|layan|mynt|fouka|فوكا|تطوير|d-?bay|sawah|parkview|osool/i,
  },
  {
    key: 'owners',
    label: 'Owner payouts',
    test: /^(sahel|sokhna|gaia)\b|owner|^[a-z]{1,3}\d|\bch-?\d|-g0\d|^v-?\d|^f\d|^st\d|^sa-|^cl ?\d|^b\d|^c\d/i,
  },
];

const num = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Month of a cell: Excel serial, Date, or text in the sheet's own day/month order. */
function monthOf(value, textOrder) {
  if (value instanceof Date) return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}` : null;
  }
  const m = String(value || '').trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!m) return null;
  let [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 100) y += 2000;
  let month = textOrder === 'dm' ? b : a;
  if (a > 12) month = b;
  else if (b > 12) month = a;
  if (month < 1 || month > 12) return null;
  return `${y}-${String(month).padStart(2, '0')}`;
}

function classify(label, fallback) {
  const text = String(label || '').trim();
  for (const ex of EXCLUDED) if (ex.test.test(text)) return { excluded: ex.key };
  for (const c of CATEGORIES) if (c.test.test(text)) return { category: c.key };
  return fallback;
}

const sheetRows = (file, sheet) =>
  XLSX.utils.sheet_to_json(XLSX.readFile(file, { cellDates: true }).Sheets[sheet], {
    header: 1,
    raw: true,
    blankrows: false,
  });

const totals = {};
const labels = {};
const excluded = {};
const unclassified = {};
function addSpend(category, month, amount, label) {
  totals[category] = totals[category] || {};
  totals[category][month] = (totals[category][month] || 0) + amount;
  labels[category] = labels[category] || {};
  labels[category][label] = (labels[category][label] || 0) + amount;
}

function readSheet({ file, sheet, skip, dateCol, labelCols, outCols, textOrder, fallback, source }) {
  for (const r of sheetRows(file, sheet).slice(skip)) {
    const amount = outCols.reduce((s, c) => s + num(r[c]), 0);
    if (!(amount > 0)) continue;
    const month = monthOf(r[dateCol], textOrder);
    if (!month) continue;
    const label = labelCols.map((c) => String(r[c] || '').trim()).find(Boolean) || '(no label)';
    const found = classify(label, fallback);
    if (found?.category) addSpend(found.category, month, amount, label);
    else if (found?.excluded) excluded[found.excluded] = (excluded[found.excluded] || 0) + amount;
    else unclassified[`${source}: ${label}`] = (unclassified[`${source}: ${label}`] || 0) + amount;
  }
}

// Treasury: cash, ADIB and CIB out. Unrecognised labels are left out rather than guessed.
readSheet({
  file: treasuryFile, sheet: 'Daily Cash', skip: 3, dateCol: 0, labelCols: [5, 1],
  outCols: [7, 9, 11], textOrder: 'dm', fallback: null, source: 'Treasury',
});
// Office petty cash and the field petty cash are day-to-day spending; unknown labels count as general.
readSheet({
  file: treasuryFile, sheet: 'Petty Cash Office', skip: 2, dateCol: 0, labelCols: [2, 3],
  outCols: [6], textOrder: 'md', fallback: { category: 'general' }, source: 'Office petty cash',
});
readSheet({
  file: pettyFile, sheet: 'Petty Cash', skip: 2, dateCol: 0, labelCols: [2, 3],
  outCols: [6], textOrder: 'dm', fallback: { category: 'general' }, source: 'Petty cash',
});

const months = [...new Set(Object.values(totals).flatMap((m) => Object.keys(m)))].sort();
const round = (n) => Math.round(n * 100) / 100;
const out = {
  source_files: [path.basename(treasuryFile), path.basename(pettyFile)],
  generated_at: new Date().toISOString().slice(0, 10),
  months,
  categories: CATEGORIES.filter((c) => totals[c.key]).map((c) => ({
    key: c.key,
    label: c.label,
    monthly: Object.fromEntries(Object.entries(totals[c.key]).sort().map(([m, v]) => [m, round(v)])),
    top_labels: Object.entries(labels[c.key])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([label, amount]) => ({ label, amount: round(amount) })),
  })),
  excluded: EXCLUDED.filter((e) => excluded[e.key]).map((e) => ({ label: e.label, amount: round(excluded[e.key]) })),
  unclassified: Object.entries(unclassified)
    .sort((a, b) => b[1] - a[1])
    .map(([label, amount]) => ({ label, amount: round(amount) })),
};

const target = path.join(__dirname, '../src/lib/finance/expenseHistory.json');
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${target}: ${out.categories.length} categories, ${months.length} months (${months[0]}..${months.at(-1)})`);
console.log('Excluded:', out.excluded.map((e) => `${e.label} ${Math.round(e.amount)}`).join(' | '));
console.log('Unclassified (left out):', out.unclassified.slice(0, 25).map((u) => `${u.label} ${Math.round(u.amount)}`).join(' | '));
