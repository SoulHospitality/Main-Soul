// Merge helper for the three-branch merge (docs/finance/MERGE_AND_DEPLOYMENT_PACKAGE.md). Run from the repository root
// while a merge is stopped on Server/package.json (and Server/package-lock.json). It never commits.
// Three-way resolution of Server/package.json (base = stage 1, ours = 2, theirs = 3): each side keeps the changes it
// made relative to the base; a key changed differently on both sides stops the merge. The test script is the union
// of both lists. Server/package-lock.json, if conflicted, takes OURS (in the documented order fix → security →
// finance, ours already contains the security upgrades) and is regenerated from the resolved package.json.
const { execSync } = require('child_process'); const fs = require('fs');
const sh = (c) => execSync(c, { encoding: 'utf8', maxBuffer: 64 << 20 });
const unresolved = sh('git diff --name-only --diff-filter=U').trim().split('\n').filter(Boolean);
const other = unresolved.filter((f) => !['Server/package.json', 'Server/package-lock.json'].includes(f));
if (other.length) { console.error('UNDOCUMENTED CONFLICTS:', other); process.exit(2); }
const stage = (n) => JSON.parse(sh(`git show :${n}:Server/package.json`));
const [base, ours, theirs] = [stage(1), stage(2), stage(3)];
const clashes = [];
function merge3(b = {}, o = {}, t = {}, where) {
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)])) {
    const [bv, ov, tv] = [b[k], o[k], t[k]].map((v) => JSON.stringify(v));
    let r;
    if (ov === tv) r = o[k]; else if (ov === bv) r = t[k]; else if (tv === bv) r = o[k];
    else { clashes.push(`${where}.${k}: ours ${ov} theirs ${tv}`); r = o[k]; }
    if (r !== undefined) out[k] = r;
  }
  return out;
}
const list = (s) => (s || '').replace(/^node --test /, '').split(/\s+/).filter(Boolean);
const scripts = merge3(base.scripts, { ...ours.scripts, test: base.scripts.test }, { ...theirs.scripts, test: base.scripts.test }, 'scripts');
const tests = [...new Set([...list(ours.scripts.test), ...list(theirs.scripts.test)])].filter((f) => list(base.scripts.test).includes(f) || list(ours.scripts.test).includes(f) || list(theirs.scripts.test).includes(f));
scripts.test = 'node --test ' + tests.join(' ');
const out = { ...ours, scripts };
for (const sect of ['dependencies', 'devDependencies']) {
  if (!base[sect] && !ours[sect] && !theirs[sect]) continue;
  const m = merge3(base[sect], ours[sect], theirs[sect], sect);
  out[sect] = Object.fromEntries(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));
}
for (const k of ['name', 'version', 'main', 'engines', 'private']) { const m = merge3({ x: base[k] }, { x: ours[k] }, { x: theirs[k] }, k); if (m.x !== undefined) out[k] = m.x; }
if (clashes.length) { console.error('TRUE CLASHES (need a human):', clashes); process.exit(4); }
fs.writeFileSync('Server/package.json', JSON.stringify(out, null, 2) + '\n');
if (unresolved.includes('Server/package-lock.json')) sh('git checkout --ours Server/package-lock.json');
sh('npm install --package-lock-only --no-audit --no-fund --prefix Server');
for (const f of ['Server/package.json', 'Server/package-lock.json']) if (/^(<<<<<<<|>>>>>>>)/m.test(fs.readFileSync(f, 'utf8'))) { console.error('markers left in', f); process.exit(3); }
const d = out.dependencies;
console.log(`resolved: ${tests.length} tests | express ${d.express} socket.io ${d['socket.io']} nodemailer ${d.nodemailer} xlsx ${d.xlsx.replace(/.*xlsx-/, '').replace('.tgz', '')} decimal.js ${d['decimal.js'] || '-'} csv-parse ${d['csv-parse'] || 'absent'}`);
