// Local end-to-end screenshots of the Financial System ledger pages (docs/finance/FINANCIAL_SYSTEM_UI.md).
// Needs embedded-postgres, pg and playwright-core (Chrome installed). Uses ports 54360, 5000 and 5181; local only.
// NODE_PATH="<embedded-postgres dir>;<Server>/node_modules" node ui-e2e.js <repo> <harness.js> <seed174.js> <playwright-core dir> <out dir>
// node ui-e2e.js <repo root> <harness.js> <seed174.js> <playwright-core dir> <out dir>
const path = require('path'); const fs = require('fs'); const { spawn } = require('child_process'); const crypto = require('crypto');
const [REPO, HARNESS, SEED, PW, OUT] = process.argv.slice(2);
const S = path.join(REPO, 'Server');
const { bootReal, applyMigration } = require(HARNESS);
const { seed174 } = require(SEED);
const { chromium } = require(path.join(PW, 'playwright-core'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const procs = [];
async function waitFor(url, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const r = await fetch(url); if (r.status < 500) return true; } catch {} await wait(1000); }
  throw new Error('timeout waiting for ' + url);
}
(async () => {
  const env = await bootReal(S, { until: '174', port: 54360 });
  const { db, query, url } = env;
  const results = [];
  try {
    // History first (before snapshots existed), then deploy 175/176 the way production will.
    const { staff } = await seed174(query);
    await query(`INSERT INTO financial_posted_entries (year_month, kind, entry_id, entry_date, entry) VALUES ('2026-10','frozen','X-unknown-1','2026-10-20',
      '{"id":"X-unknown-1","date":"2026-10-20","type":"manual","lines":[{"account":"105000","debit":100,"credit":0},{"account":"999999","debit":0,"credit":100}]}')`);
    await applyMigration(db, S, '175_commission_snapshots.sql');
    await applyMigration(db, S, '176_ledger_core.sql');
    await query(`UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'`);
    const pw = crypto.randomBytes(9).toString('hex');
    const bcrypt = require(path.join(S, 'node_modules/bcryptjs'));
    await query(`INSERT INTO staff_users (username, password_hash, full_name, role, is_active, is_first_login) VALUES ('ui-admin', $1, 'UI Admin', 'admin', 1, 0)`, [await bcrypt.hash(pw, 10)]);
    await query(`INSERT INTO ledger_policies (version, effective_from, settings, status, created_by) VALUES ('2026.1-draft', '2026-12-01', '{"revenue_presentation":"to be decided","vat_base":"to be decided"}', 'draft', $1)`, [staff[1]]);
    // A new booking after deployment: captured automatically.
    await query(`INSERT INTO reservations (unit_id, guest_name, guest_phone, check_in, check_out, nights, price_per_night, total_amount, status, created_by, sales_person_id)
      SELECT unit_id, 'Post-deploy Guest', '0100', '2027-01-10', '2027-01-12', 2, 2500, 5000, 'confirmed', $1, $1 FROM reservations LIMIT 1`, [staff[0]]);

    const serverEnv = { ...process.env, DATABASE_URL: url, MIGRATION_DATABASE_URL: url, PORT: '5000', NODE_ENV: 'development',
      JWT_SECRET: 'ui-e2e-' + crypto.randomBytes(16).toString('hex'), LEDGER_IDENTITY_KEY_ID: 'local-ui', LEDGER_IDENTITY_KEY: crypto.randomBytes(32).toString('hex') };
    delete serverEnv.RESEND_API_KEY; delete serverEnv.SMTP_HOST;
    const srv = spawn(process.execPath, ['src/server.js'], { cwd: S, env: serverEnv }); procs.push(srv);
    let srvLog = ''; srv.stdout.on('data', (d) => (srvLog += d)); srv.stderr.on('data', (d) => (srvLog += d));
    await waitFor('http://127.0.0.1:5000/api/health');
    const vite = spawn(process.execPath, [path.join(REPO, 'Client/node_modules/vite/bin/vite.js'), '--port', '5181', '--strictPort', '--host', '127.0.0.1'], { cwd: path.join(REPO, 'Client'), env: process.env }); procs.push(vite);
    await waitFor('http://127.0.0.1:5181/');

    const login = await (await fetch('http://127.0.0.1:5000/api/staff/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'ui-admin', password: pw }) })).json();
    if (!login.token) throw new Error('login failed: ' + JSON.stringify(login).slice(0, 200));
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const locale of ['en', 'ar']) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await ctx.addInitScript(([tok, user, loc]) => { localStorage.setItem('pms_token', tok); localStorage.setItem('pms_user', user); localStorage.setItem('soul_fin_locale', loc); localStorage.setItem('soul_fin_period', JSON.stringify({ from: '2026-10-01', to: '2026-12-31', basis: 'stay' })); },
        [login.token, JSON.stringify(login.user), locale]);
      const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
      for (const [tool, extra] of [['ledger', ''], ['commission-review', ''], ['statements', '&sub=pnl&from=2026-10-01&to=2026-12-31']]) {
        await page.goto(`http://127.0.0.1:5181/admin/financial-system?tool=${tool}${extra}`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(1500);
        const file = path.join(OUT, `fin-${tool}-${locale}.png`);
        await page.screenshot({ path: file, fullPage: true });
        const text = await page.evaluate(() => document.body.innerText);
        results.push({ locale, tool, file, chars: text.length, rawKeys: (text.match(/pms\.fin\.[a-zA-Z.]+/g) || []).slice(0, 5) });
      }
      results.push({ locale, errors });
      await ctx.close();
    }
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'ui-e2e-server.log'), srvLog);
    console.log(JSON.stringify(results, null, 1));
  } finally {
    for (const p of procs) { try { p.kill(); if (process.platform === 'win32') spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']); } catch {} }
    await wait(1500);
    await env.stop();
  }
  process.exit(0);
})().catch((e) => { console.error('CRASH', e.stack); for (const p of procs) { try { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F']); } catch {} } process.exit(1); });
