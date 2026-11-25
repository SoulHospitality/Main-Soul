// scripts/ledger-migration.js as the DBA runs it, on a REAL local PostgreSQL 17.5 (synthetic data; local only).
// Usage: NODE_PATH="<dir with embedded-postgres and pg>;<Server>/node_modules" node migration-cli-real-test.js <Server>
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { bootReal, applyMigration, provisionIdentity, claimSql } = require('./harness');
const { seed174 } = require('./seed174');

const S = process.argv[2];
let passed = 0;
let failed = 0;
const ok = (cond, name, detail) => {
  if (cond) { passed++; console.log(`PASS ${name}`); } else { failed++; console.log(`FAIL ${name}${detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 600) : ''}`); }
};

(async () => {
  const env = await bootReal(S, { until: '174', port: 54370 });
  const { db, query, url } = env;
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-mig-'));
  try {
    console.log(env.version);
    await seed174(query);
    await applyMigration(db, S, '175_commission_snapshots.sql');
    await applyMigration(db, S, '176_ledger_core.sql');
    await query(`UPDATE financial_settings SET value_text = '2026-09-01T00:00:00Z' WHERE key = 'books_reset_at'`);
    const { keyId, hex } = await provisionIdentity(query);
    const identity = require(path.join(S, 'src/lib/accounting/identity.js'));
    await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (995,'mc_admin','x','MC Admin','admin',1),(996,'mc_admin2','x','MC Admin 2','admin',1),(997,'mc_rec','x','MC Recorder','reservations',1)`);
    await identity.recordApproval({ purpose: 'policy_d01', subject: 'CLI-TEST', approverId: 995 });
    await identity.recordApproval({ purpose: 'policy_vat', subject: 'CLI-TEST', approverId: 996 });
    await db.exec(`BEGIN; ${claimSql(997)}; INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref, created_by)
      VALUES ('CLI-TEST', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_plus_cleaning"}', 'approved', 995, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 996, now(), 'SYNTHETIC TEST - NOT AN APPROVAL', 997); COMMIT;`);
    await db.exec(`BEGIN; ${claimSql(995)}; SELECT set_config('app.control_reason','synthetic CLI test',true); UPDATE financial_settings SET value_text='on' WHERE key='ledger_posting'; COMMIT;`);

    const cli = (...argv) => {
      const r = spawnSync(process.execPath, [path.join(S, 'scripts/ledger-migration.js'), ...argv, '--out', out], {
        cwd: S, encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: url, LEDGER_IDENTITY_KEY_ID: keyId, LEDGER_IDENTITY_KEY: hex, NODE_ENV: 'development' },
      });
      return { code: r.status, out: r.stdout, err: r.stderr };
    };
    const range = ['--from', '2026-10-01', '--to', '2026-12-31'];
    const entries = async () => Number((await query(`SELECT COUNT(*)::int n FROM ledger_entries`)).rows[0].n);

    let r = cli('plan', ...range, '--policy', 'CLI-TEST');
    ok(r.code === 0 && /"balanced": true/.test(r.out) && /Target database host: 127\.0\.0\.1/.test(r.err), 'plan: exit 0, balanced, names the target host', r);
    ok((await entries()) === 0, 'plan writes nothing');
    r = cli('execute', ...range, '--policy', 'CLI-TEST', '--actor', '995', '--confirm-host', '127.0.0.1');
    ok(r.code === 2 && /add --execute/.test(r.err), 'execute without --execute is refused (exit 2)', r.err);
    r = cli('execute', ...range, '--policy', 'CLI-TEST', '--actor', '995', '--confirm-host', 'db.prod.example', '--execute');
    ok(r.code === 2 && /--confirm-host must equal/.test(r.err), 'execute with the wrong --confirm-host is refused (exit 2)', r.err);
    r = cli('execute', ...range, '--policy', 'CLI-TEST', '--confirm-host', '127.0.0.1', '--execute');
    ok(r.code === 2 && /--actor/.test(r.err), 'execute without --actor is refused (exit 2)', r.err);
    ok((await entries()) === 0, 'none of the refusals wrote anything');
    r = cli('execute', ...range, '--policy', 'CLI-TEST', '--actor', '995', '--confirm-host', '127.0.0.1', '--execute');
    ok(r.code === 0 && /"ok": true/.test(r.out) && /"clean": true/.test(r.out), 'execute: posts, then reconciles clean (exit 0)', { out: r.out.slice(-700), err: r.err.slice(-400) });
    const n = await entries();
    ok(n > 10 && (await query(`SELECT COUNT(*)::int n FROM ledger_entries WHERE created_by = 995`)).rows[0].n === n, `${n} entries posted, each recording the verified person who ran it`);
    r = cli('reconcile', ...range);
    ok(r.code === 0 && /"clean": true/.test(r.out), 'reconcile: clean (exit 0)', r.out);
    // A stay in a closed (frozen) month: the books keep the frozen copy, so nothing changes.
    await query(`UPDATE reservations SET total_amount = total_amount + 300, price_per_night = price_per_night + 100 WHERE id = (SELECT MIN(id) FROM reservations WHERE status = 'checked_out' AND check_in < '2026-11-01')`);
    r = cli('reconcile', ...range);
    ok(r.code === 0 && /"clean": true/.test(r.out), 'an edit to a stay in a frozen month leaves the reconciliation clean (the closed month keeps its frozen copy)', r.out);
    // A stay in an open month: the reference changes.
    await query(`UPDATE reservations SET total_amount = total_amount + 300, price_per_night = price_per_night + 100 WHERE id = (SELECT MIN(id) FROM reservations WHERE status IN ('checked_out', 'checked_in') AND check_in >= '2026-11-01')`);
    r = cli('reconcile', ...range);
    ok(r.code === 1 && /"amount_break": [1-9]/.test(r.out), 'after a booking edit, reconcile reports breaks (exit 1)', r.out);
    r = cli('sync', ...range, '--policy', 'CLI-TEST', '--actor', '995', '--confirm-host', '127.0.0.1', '--execute');
    ok(r.code === 0 && /"replaced": [1-9]/.test(r.out) && /"clean": true/.test(r.out), 'sync replaces the changed entries and reconciles clean (exit 0)', { out: r.out.slice(-600), err: r.err.slice(-300) });
    const files = fs.readdirSync(out);
    ok(files.some((f) => f.endsWith('plan.json')) && files.some((f) => f.endsWith('run.json')) && files.some((f) => f.endsWith('.csv')), `evidence files written (${files.length})`, files);
    const ev = fs.readFileSync(path.join(out, files.find((f) => f.endsWith('run.json'))), 'utf8');
    ok(!ev.includes(hex) && !ev.includes(url), 'evidence contains neither the identity key nor the database URL');
  } finally {
    await env.stop();
    fs.rmSync(out, { recursive: true, force: true });
  }
  console.log(failed ? `\n${failed} FAILED (${passed} passed)` : `\nALL ${passed} PASSED`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
