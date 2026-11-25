#!/usr/bin/env node
/**
 * Historical migration, parallel-run sync and reconciliation for the stored ledger
 * (docs/finance/HISTORICAL_MIGRATION_RUNBOOK.md). Run by the authorised DBA/finance lead only, after the gates.
 *
 *   node scripts/ledger-migration.js plan      --from 2026-10-01 --to 2026-12-31 --policy <version> [--opening balances.json]
 *   node scripts/ledger-migration.js reconcile --from 2026-10-01 --to 2026-12-31
 *   node scripts/ledger-migration.js execute   --from … --to … --policy <version> --actor <staff id> --confirm-host <db host> --execute
 *   node scripts/ledger-migration.js sync      --from … --to … --policy <version> --actor <staff id> --confirm-host <db host> --execute
 *
 * Every command writes its evidence (JSON, and CSV for reconcile) to --out (default ./ledger-migration-evidence).
 * plan and reconcile only read. execute and sync write, and refuse unless --execute is given AND --confirm-host
 * equals the host of DATABASE_URL exactly. The database still refuses to post while posting is off or without an
 * approved policy.
 */
const fs = require('fs');
const path = require('path');

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function dbHost() {
  try { return new URL(process.env.DATABASE_URL || '').hostname || null; } catch { return null; }
}

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (!['plan', 'reconcile', 'execute', 'sync'].includes(cmd)) {
    console.error('Usage: ledger-migration.js plan|reconcile|execute|sync --from YYYY-MM-DD --to YYYY-MM-DD [...]');
    return 2;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL must be set explicitly for this command (the target database).');
    return 2;
  }
  const host = dbHost();
  console.error(`Target database host: ${host}`);
  const writes = cmd === 'execute' || cmd === 'sync';
  if (writes) {
    if (a.execute !== true) { console.error(`${cmd} writes to the ledger: add --execute to proceed.`); return 2; }
    if (!a['confirm-host'] || a['confirm-host'] !== host) { console.error(`--confirm-host must equal the target host (${host}).`); return 2; }
    if (!a.actor) { console.error('--actor <staff id> is required (the verified person running it).'); return 2; }
  }
  const mig = require('../src/lib/accounting/historicalMigration');
  const outDir = path.resolve(a.out || 'ledger-migration-evidence');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const write = (name, data) => {
    const f = path.join(outDir, `${cmd}-${a.from}-${a.to}-${stamp}.${name}`);
    fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    console.error(`evidence: ${f}`);
  };

  if (cmd === 'reconcile') {
    const r = await mig.reconcile({ from: a.from, to: a.to });
    write('json', r);
    write('csv', mig.reconciliationCsv(r));
    console.log(JSON.stringify({ clean: r.clean, buckets: r.buckets, accountsWithDifferences: r.accountsWithDifferences.length }, null, 2));
    return r.clean ? 0 : 1;
  }

  const openingBalances = a.opening ? JSON.parse(fs.readFileSync(a.opening, 'utf8')) : null;
  const p = await mig.plan({ from: a.from, to: a.to, policyVersion: a.policy, openingBalances });
  const { entries, ...summary } = p;
  write('plan.json', { ...summary, entries: entries.map((e) => ({ key: e.idempotencyKey, date: e.transactionDate, type: e.sourceType, lines: e.lines.length })) });
  console.log(JSON.stringify({ counts: p.counts, balanced: p.balanced, errors: p.errors.length, months: p.months }, null, 2));
  if (cmd === 'plan') return p.errors.length || !p.balanced ? 1 : 0;

  const actorId = Number(a.actor);
  const result = cmd === 'execute' ? await mig.execute(p, { actorId, runBy: `staff ${actorId}` }) : await mig.sync(p, { actorId });
  write('run.json', result);
  console.log(JSON.stringify(result, null, 2));
  const failedRun = cmd === 'execute' ? !result.ok : result.failed.length > 0;
  if (failedRun) return 1;
  const r = await mig.reconcile({ from: a.from, to: a.to });
  write('reconcile.json', r);
  write('reconcile.csv', mig.reconciliationCsv(r));
  console.log(JSON.stringify({ reconciliation: { clean: r.clean, buckets: r.buckets } }, null, 2));
  return r.clean ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`${e.code || 'ERROR'}: ${e.message}`);
    if (e.detail) console.error(JSON.stringify(e.detail, null, 2));
    process.exit(1);
  });
