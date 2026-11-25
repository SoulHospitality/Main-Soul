#!/usr/bin/env node
/**
 * Record the accounting policy and its two approvals (docs/finance/FINANCE_GO_LIVE.md). Each person runs their own
 * step; the database refuses anything else.
 *
 *   node scripts/ledger-policy.js approve --purpose d01 --version 2026.11 --actor <admin A id> --confirm-host <host> --execute
 *   node scripts/ledger-policy.js approve --purpose vat --version 2026.11 --actor <admin B id> --confirm-host <host> --execute
 *   node scripts/ledger-policy.js record  --version 2026.11 --effective 2026-11-25 --settings <policy.json> --actor <recorder id>
 *        --d01-approver <A> --d01-ref "<written reference>" --vat-approver <B> --vat-ref "<written reference>" --confirm-host <host> --execute
 *   node scripts/ledger-policy.js posting on|off --actor <admin id> --reason "<authorisation ref>" --confirm-host <host> --execute
 *   node scripts/ledger-policy.js reports ledger|engine --actor <admin id> --reason "<authorisation ref>" --confirm-host <host> --execute
 *
 * Writes only with --execute and --confirm-host equal to the target host. The written references are the
 * accountant's documents: they are typed by the person recording, never filled in by this tool.
 */
const fs = require('fs');

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

async function main() {
  const a = args(process.argv.slice(2));
  const cmd = a._[0];
  if (!['approve', 'record', 'posting', 'reports'].includes(cmd)) { console.error('Usage: ledger-policy.js approve|record|posting|reports ...'); return 2; }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL must be set explicitly (the target database).'); return 2; }
  let host = null;
  try { host = new URL(process.env.DATABASE_URL).hostname; } catch { /* reported below */ }
  console.error(`Target database host: ${host}`);
  if (a.execute !== true) { console.error(`${cmd} writes to the database: add --execute to proceed.`); return 2; }
  if (!a['confirm-host'] || a['confirm-host'] !== host) { console.error(`--confirm-host must equal the target host (${host}).`); return 2; }
  if (!a.actor) { console.error('--actor <staff id> is required (the verified person doing this step).'); return 2; }
  if (cmd === 'posting' || cmd === 'reports') {
    const value = a._[1];
    const allowed = cmd === 'posting' ? ['on', 'off'] : ['ledger', 'engine'];
    if (!allowed.includes(value)) { console.error(`${cmd} takes ${allowed.join(' or ')}`); return 2; }
    if (!a.reason || String(a.reason).trim().length < 10) { console.error('--reason (10+ characters, e.g. the authorisation reference) is required.'); return 2; }
    if (cmd === 'posting') await require('../src/lib/accounting/posting').setPostingSwitch(value, { actorId: Number(a.actor), reason: String(a.reason) });
    else await require('../src/lib/accounting/reportSource').setReportSource(value, { actorId: Number(a.actor), reason: String(a.reason) });
    console.log(JSON.stringify({ [cmd]: value, by: Number(a.actor) }));
    return 0;
  }
  const policy = require('../src/lib/accounting/policy');
  if (cmd === 'approve') {
    await policy.approve({ version: a.version, purpose: a.purpose, actorId: a.actor });
    console.log(JSON.stringify({ approved: true, purpose: a.purpose, version: a.version, by: Number(a.actor) }));
    return 0;
  }
  if (!a.settings) { console.error('--settings <policy.json> is required.'); return 2; }
  const settings = JSON.parse(fs.readFileSync(a.settings, 'utf8')).settings;
  const row = await policy.recordApproved({
    version: a.version, effectiveFrom: a.effective, settings, recorderId: a.actor,
    d01ApproverId: a['d01-approver'], d01Ref: a['d01-ref'], vatApproverId: a['vat-approver'], vatRef: a['vat-ref'],
  });
  console.log(JSON.stringify(row));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => { console.error(`${e.code || 'ERROR'}: ${e.message}`); process.exit(1); });
