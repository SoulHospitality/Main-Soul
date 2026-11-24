// Split a SQL script into statements the way psql sends them (each its own implicit transaction),
// respecting quotes, dollar quotes and comments.
function splitSql(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  let dollar = null;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollar) {
      if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue; }
      cur += ch; i++; continue;
    }
    if (ch === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); const end = e < 0 ? sql.length : e; cur += sql.slice(i, end); i = end; continue; }
    if (ch === "'") { let j = i + 1; while (j < sql.length) { if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; } if (sql[j] === "'") break; j++; } cur += sql.slice(i, j + 1); i = j + 1; continue; }
    if (ch === '$') { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) { dollar = m[0]; cur += dollar; i += dollar.length; continue; } }
    if (ch === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  if (cur.replace(/--.*$/gm, '').trim()) out.push(cur.trim());
  return out.filter((s) => s.replace(/--.*$/gm, '').trim());
}
module.exports = { splitSql };
