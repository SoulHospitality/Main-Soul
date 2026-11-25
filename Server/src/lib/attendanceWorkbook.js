const XLSX = require('xlsx');

/**
 * Rows of the first sheet of an attendance workbook (.xlsx, or binary .xls),
 * as objects keyed by the header row, with empty cells as '' and date cells as Date.
 *
 * xlsx comes from the SheetJS CDN (0.20.3): the npm registry stops at 0.18.5,
 * which has the prototype-pollution (CVE-2023-30533) and ReDoS (CVE-2024-22363) flaws.
 */
function readFirstSheetRows(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true });
  if (!wb.SheetNames?.length) {
    const err = new Error('The Excel file has no sheets');
    err.status = 400;
    throw err;
  }
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

module.exports = { readFirstSheetRows, XLSX_VERSION: XLSX.version };
