// Runs each live-check script on a fresh migrated DB with sample data; proves they parse and are read-only.
const fs = require('fs');
const path = require('path');
const { boot } = require('./harness');
const S = process.argv[2];
const dir = path.join(S, '..', 'docs/finance/live-checks');
(async () => {
  const { db } = await boot(S, { until: '174' }); // production state today
  await db.exec(`
    INSERT INTO public.financial_posted_entries (year_month, kind, entry_id, entry_date, entry)
    VALUES ('2026-10','frozen','e1','2026-10-05','{"id":"e1","lines":[{"account":"103000","debit":100,"credit":0},{"account":"404000","debit":0,"credit":100}]}'),
           ('2026-10','frozen','e2','2026-10-06','{"id":"e2","lines":[{"account":"103000","debit":50,"credit":0},{"account":"404000","debit":0,"credit":49.99}]}');`);
  let fail = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    if (/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT)\b/i.test(sql.replace(/--.*$/gm, ''))) { console.log('FAIL write keyword', f); fail++; }
    try {
      const res = await db.exec(sql);
      console.log('ok', f, res.filter((r) => r.fields.length).map((r) => r.rows.length + ' rows').join(', '));
      if (f.startsWith('00')) { const v = Object.fromEntries(res.find((r) => r.fields.length).rows.map((r) => [r.item, r.value])); const good = /^174_/.test(v['last applied migration']) && v['175-179 applied'] === '0' && v['ledger_reports setting exists'] === '0' && v['reservations.commission_snapshot column exists'] === 'false' && v['ledger tables exist'] === '0' && v['ledger_posting setting exists'] === '0'; console.log('   check 0 reads pre-deployment state correctly:', good, JSON.stringify(v)); if (!good) fail++; }
      if (f.startsWith('06')) console.log('   ', JSON.stringify(res.filter((r) => r.fields.length).map((r) => r.rows)));
    } catch (e) { console.log('FAIL', f, e.message); fail++; try { await db.exec('ROLLBACK'); } catch (_) {} }
  }
  try { await db.exec('BEGIN TRANSACTION READ ONLY; DELETE FROM public.payments; ROLLBACK;'); console.log('FAIL write allowed'); fail++; }
  catch (e) { console.log('ok read-only guard:', e.message); await db.exec('ROLLBACK'); }
  console.log(fail ? `${fail} FAILED` : 'ALL PASS');
})();
