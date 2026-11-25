const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const { readFirstSheetRows, XLSX_VERSION } = require('./attendanceWorkbook');
const { parseAttendanceRows, assertOriginalRecordsAttendanceTemplate } = require('./hrRules');

const HEAD = ['Person ID', 'Name', 'Department', 'Time', 'Attendance Status'];
// Excel serial for 2026-08-30 09:00 and 2026-08-30 17:45 (no timezone involved).
const DAY = (Date.UTC(2026, 7, 30) - Date.UTC(1899, 11, 30)) / 86400000;
const ROWS = [
  ["'15", 'Ahmed Ali', 'Ops', '8/30/2026 08:58', 'Check-in'],
  ["'15", 'Ahmed Ali', 'Ops', '8/30/2026 17:31', 'Check-out'],
  [16, 'منى حسن', 'HK', DAY + 9 / 24, 'Check-in'],
  [16, 'منى حسن', 'HK', DAY + 17.75 / 24, 'Overtime Out'],
];
const EXPECTED = [
  { staff_code: '15', date: '2026-08-30', arrival_time: '08:58', is_check_in: true },
  { staff_code: '15', date: '2026-08-30', arrival_time: '17:31', is_check_out: true },
  { staff_code: '16', date: '2026-08-30', arrival_time: '09:00', is_check_in: true },
  { staff_code: '16', date: '2026-08-30', arrival_time: '17:45', is_check_out: true },
];

function sheetjsWorkbook(bookType) {
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...ROWS]);
  for (let r = 3; r <= 4; r++) ws[XLSX.utils.encode_cell({ r, c: 3 })].z = 'm/d/yyyy h:mm';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Original Records');
  return XLSX.write(wb, { type: 'buffer', bookType });
}

function check(rows) {
  assertOriginalRecordsAttendanceTemplate(rows);
  const parsed = parseAttendanceRows(rows);
  assert.equal(parsed.length, EXPECTED.length);
  EXPECTED.forEach((want, i) => {
    for (const [k, v] of Object.entries(want)) assert.equal(parsed[i][k], v, `row ${i} ${k}`);
  });
}

describe('attendance workbook reading', () => {
  it('uses a SheetJS build with the security fixes (>= 0.20.2)', () => {
    const [maj, min, patch] = XLSX_VERSION.split('.').map(Number);
    assert.ok(maj > 0 || min > 20 || (min === 20 && patch >= 2), `xlsx ${XLSX_VERSION}`);
  });

  for (const bookType of ['xlsx', 'biff8']) {
    it(`reads ${bookType === 'xlsx' ? '.xlsx' : 'binary .xls (BIFF8)'} door reports`, () => {
      check(readFirstSheetRows(sheetjsWorkbook(bookType)));
    });
  }

  it('reads an .xlsx written by another producer (exceljs), empty cells as ""', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    ws.addRow([...HEAD, 'Temperature']);
    ROWS.forEach((r) => ws.addRow(r));
    for (let r = 4; r <= 5; r++) ws.getCell(r, 4).numFmt = 'm/d/yyyy h:mm';
    const rows = readFirstSheetRows(Buffer.from(await wb.xlsx.writeBuffer()));
    assert.equal(rows[0].Temperature, '');
    check(rows);
  });

  it('a workbook without sheets is refused with a 400', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'S');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const orig = XLSX.read;
    XLSX.read = () => ({ SheetNames: [], Sheets: {} });
    try {
      assert.throws(() => readFirstSheetRows(buf), (e) => e.status === 400 && /no sheets/.test(e.message));
    } finally {
      XLSX.read = orig;
    }
  });
});
