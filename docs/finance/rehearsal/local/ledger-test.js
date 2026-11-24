// Ledger core (migration 176) + commission snapshots (migration 175) + posting service, on PGlite.
const path = require('path');
const { boot } = require('./harness');
const S = process.argv[2];
let failed = 0;
const ok = (c, l, x = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) failed += 1; };
const rejects = async (fn, re) => { try { await fn(); return false; } catch (e) { return re ? re.test(e.message) || re.test(e.code || '') : true; } };

(async () => {
  const { query, db } = await boot(S);
  const posting = require(path.join(S, 'src/lib/accounting/posting.js'));
  const snaps = require(path.join(S, 'src/lib/accounting/commissionSnapshots.js'));
  const egp = (a, d, c) => ({ account: a, debit: d, credit: c });

  const accounts = Number((await query('SELECT COUNT(*)::int AS n FROM ledger_accounts WHERE is_system')).rows[0].n);
  ok(accounts === 47, 'chart seeded with the 47 existing account codes', String(accounts));
  const sw = (await query(`SELECT value_text FROM financial_settings WHERE key = 'ledger_posting'`)).rows[0]?.value_text;
  ok(sw === 'off', 'posting switch starts off', sw);

  const base = { transactionDate: '2026-11-10', description: 'Test collection', sourceModule: 'test', sourceType: 'payment', sourceId: '1', idempotencyKey: 'payment:1', policyVersion: 'P-TEST', lines: [egp('103000', '1140.00', 0), egp('105000', 0, '1140.00')] };
  const rawEntry = (num, pol) => `INSERT INTO ledger_entries (number, transaction_date, period, description, source_module, source_type, source_id, origin, idempotency_key, policy_version)
        VALUES ('${num}', '2026-11-11', '2026-11', 'bypass', 'test', 'x', '1', 'manual', 'bypass:${num}', ${pol ? `'${pol}'` : 'NULL'})`;
  ok(await rejects(() => posting.postEntry(base), /POSTING_OFF|switched off/), 'nothing posts while the switch is off (D-01 not approved)');
  ok(await rejects(() => query(rawEntry('JE-RAW-0', null)), /switched off/), 'the DATABASE refuses an entry written around the service while posting is off');
  ok(Number((await query('SELECT COUNT(*)::int AS n FROM ledger_entries')).rows[0].n) === 0, 'ledger stays empty');

  // Policies: both written approvals are required, and an approved policy is permanent.
  ok(await rejects(() => query(`INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref) VALUES ('P-NOVAT', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', 1, now(), 'letter-1')`), /check/i), 'a policy cannot be approved without the separate VAT approval');
  ok(await rejects(() => query(`INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref) VALUES ('P-NOBASE', '2026-01-01', '{"revenue_presentation":"gross"}', 'approved', 1, now(), 'l', 1, now(), 'v')`), /check/i), 'a policy cannot be approved without a VAT base setting');
  await query(`INSERT INTO ledger_policies (version, effective_from, settings, status) VALUES ('P-DRAFT', '2026-01-01', '{"revenue_presentation":"net","vat_base":"fee_only"}', 'draft')`);
  await query(`INSERT INTO ledger_policies (version, effective_from, settings, status, approved_by, approved_at, approval_ref, vat_approved_by, vat_approved_at, vat_approval_ref) VALUES ('P-TEST', '2026-01-01', '{"revenue_presentation":"gross","vat_base":"fee_only"}', 'approved', 1, now(), 'TEST ONLY', 1, now(), 'TEST ONLY')`);
  ok(await rejects(() => query(`UPDATE ledger_policies SET settings = '{"revenue_presentation":"net","vat_base":"fee_only"}' WHERE version = 'P-TEST'`), /cannot be changed/), 'an approved policy cannot be edited');
  ok(await rejects(() => query(`DELETE FROM ledger_policies WHERE version = 'P-TEST'`), /cannot be deleted/), 'an approved policy cannot be deleted');

  await query(`UPDATE financial_settings SET value_text = 'on' WHERE key = 'ledger_posting'`); // test database only
  ok(await rejects(() => posting.postEntry({ ...base, policyVersion: undefined, idempotencyKey: 'np:1' }), /NO_POLICY|No approved/), 'service refuses an entry without an approved policy');
  ok(await rejects(() => posting.postEntry({ ...base, policyVersion: 'P-DRAFT', idempotencyKey: 'np:2' }), /NO_POLICY|No approved/), 'a draft policy cannot be used to post');
  ok(await rejects(() => query(rawEntry('JE-RAW-1', 'P-DRAFT')), /approved accounting policy/), 'the DATABASE refuses an entry under a draft policy');
  const first = await posting.postEntry(base);
  ok(first.entry.number === 'JE-2026-000001' && !first.duplicate, 'balanced entry posts with a journal number', first.entry.number);
  const again = await posting.postEntry(base);
  ok(again.duplicate && again.entry.id === first.entry.id, 'same idempotency key → no second entry (duplicate webhook)');

  ok(await rejects(() => posting.postEntry({ ...base, idempotencyKey: 'x1', lines: [egp('103000', '100.00', 0), egp('105000', 0, '99.99')] }), /UNBALANCED/), 'unbalanced entry refused (one piaster off)');
  ok(await rejects(() => posting.postEntry({ ...base, idempotencyKey: 'x2', lines: [egp('999999', '10', 0), egp('105000', 0, '10')] }), /UNKNOWN_ACCOUNT/), 'unknown account refused');
  ok(await rejects(() => posting.postEntry({ ...base, idempotencyKey: 'x3', lines: [egp('103000', '10', '10'), egp('105000', 0, '10')] }), /ONE_SIDE/), 'a line with both debit and credit refused');
  ok(Number((await query('SELECT COUNT(*)::int AS n FROM ledger_entries')).rows[0].n) === 1, 'failed postings leave nothing behind');

  // The database itself refuses an unbalanced entry even if the service is bypassed.
  const dbUnbalanced = await rejects(async () => {
    await db.exec(`BEGIN;
      ${rawEntry('JE-TEST-1', 'P-TEST')};
      INSERT INTO ledger_lines (entry_id, line_no, account_code, debit, base_debit) SELECT id, 1, '103000', 50, 50 FROM ledger_entries WHERE number = 'JE-TEST-1';
      INSERT INTO ledger_lines (entry_id, line_no, account_code, credit, base_credit) SELECT id, 2, '105000', 40, 40 FROM ledger_entries WHERE number = 'JE-TEST-1';
      COMMIT;`);
  }, /unbalanced/i);
  await db.exec('ROLLBACK').catch(() => {});
  ok(dbUnbalanced, 'database constraint refuses an unbalanced entry written around the service');

  ok(await rejects(() => query(`INSERT INTO ledger_lines (entry_id, line_no, account_code, debit, base_debit) VALUES ($1, 9, '103000', 5, 5)`, [first.entry.id]), /only be added while/), 'a posted entry cannot gain lines later');
  ok(await rejects(() => db.exec(`BEGIN; INSERT INTO ledger_lines (entry_id, line_no, account_code, debit, base_debit) VALUES (${first.entry.id}, 10, '103000', 5, 5); INSERT INTO ledger_lines (entry_id, line_no, account_code, credit, base_credit) VALUES (${first.entry.id}, 11, '105000', 0, 5); COMMIT;`), /only be added while/), 'not even a balanced pair of lines can be added to a posted entry');
  await db.exec('ROLLBACK').catch(() => {});
  ok(await rejects(() => query(`UPDATE ledger_lines SET debit = 1 WHERE entry_id = $1`, [first.entry.id]), /immutable/), 'posted lines cannot be edited');
  ok(await rejects(() => query(`UPDATE ledger_entries SET description = 'changed' WHERE id = $1`, [first.entry.id]), /immutable/), 'posted entries cannot be edited');
  ok(await rejects(() => query(`DELETE FROM ledger_entries WHERE id = $1`, [first.entry.id]), /cannot be deleted/), 'posted entries cannot be deleted');

  const rev = await posting.reverseEntry(first.entry.id, { reason: 'Payment recorded twice', actorId: 1, date: '2026-11-12' });
  const orig = (await query('SELECT status, reversed_by_id FROM ledger_entries WHERE id = $1', [first.entry.id])).rows[0];
  const tb = await posting.trialBalance();
  ok(orig.status === 'reversed' && Number(orig.reversed_by_id) === Number(rev.id) && tb.every((r) => r.balance === '0.00'), 'reversal offsets the original exactly; original kept and marked reversed', JSON.stringify(tb));
  ok(await rejects(() => posting.reverseEntry(first.entry.id, { reason: 'again please', actorId: 1 }), /ALREADY_REVERSED/), 'an entry can only be reversed once');

  await query(`INSERT INTO ledger_periods (period, status) VALUES ('2026-10', 'closed')`);
  ok(await rejects(() => posting.postEntry({ ...base, transactionDate: '2026-10-15', idempotencyKey: 'late:1' }), /PERIOD_CLOSED/), 'posting into a closed period refused');

  // Currency: USD cash line needs its rate; base amount computed exactly.
  const usd = await posting.postEntry({ ...base, idempotencyKey: 'usd:1', lines: [{ account: '104000', debit: '100', currency: 'USD', fxRate: '48.6523' }, egp('105000', 0, '4865.23')] });
  const usdLine = (await query(`SELECT base_debit FROM ledger_lines WHERE entry_id = $1 AND line_no = 1`, [usd.entry.id])).rows[0];
  ok(String(usdLine.base_debit) === '4865.2300', 'USD line converted at its stated rate (100 × 48.6523)', String(usdLine.base_debit));
  ok(await rejects(() => posting.postEntry({ ...base, idempotencyKey: 'usd:2', lines: [{ account: '104000', debit: '100', currency: 'USD' }, egp('105000', 0, '100')] }), /NO_FX_RATE/), 'foreign line without a rate refused');
  ok(await rejects(() => posting.postEntry({ ...base, idempotencyKey: 'usd:3', lines: [egp('104000', '100', 0), egp('105000', 0, '100')] }), /CURRENCY_NOT_ALLOWED/), 'EGP line on the USD cash account refused');

  // ── Commission snapshots (D-12) ──
  await query('ALTER TABLE reservations ALTER COLUMN created_by DROP NOT NULL');
  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active, sales_commission_pct) VALUES (801,'sp','x','Sales P','reservations',1,10) ON CONFLICT (id) DO UPDATE SET sales_commission_pct = 10`);
  const unit = (await query(`INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, commission_mode) VALUES ('cs','CS','CS-1','published','rent','Marassi','Marassi',1,1,2,20,'A') RETURNING id`)).rows[0].id;

  // Historical: confirmed before snapshots existed (trigger off to simulate the past).
  await query('ALTER TABLE reservations DISABLE TRIGGER reservations_commission_snapshot');
  await query(`INSERT INTO reservations (id, unit_id, guest_name, guest_phone, check_in, check_out, nights, total_amount, status, sales_person_id) VALUES (701,$1,'Old','0','2026-09-01','2026-09-03',2,2000,'confirmed',801)`, [unit]);
  await query('ALTER TABLE reservations ENABLE TRIGGER reservations_commission_snapshot');
  await query(`UPDATE reservations SET notes = 'edited later' WHERE id = 701`);
  const hist = (await query('SELECT commission_snapshot FROM reservations WHERE id = 701')).rows[0];
  ok(hist.commission_snapshot === null, 'an already-confirmed historical stay never gets today’s rate written onto it');
  const review = (await query('SELECT reservation_id, review_reason FROM reservation_commission_review')).rows;
  ok(review.some((r) => r.reservation_id === 701 && /unknown/.test(r.review_reason)), 'historical stay listed for manual review (no personal data)', JSON.stringify(review));

  const R = (id, extra = {}) => {
    const v = { unit, status: 'pending', created: null, owner: 0, sp: 801, ...extra };
    return query(`INSERT INTO reservations (id, unit_id, guest_name, guest_phone, check_in, check_out, nights, total_amount, status, sales_person_id, is_owner_reservation${v.created ? ', created_at' : ''})
      VALUES ($1,$2,'G','0','2026-12-01','2026-12-03',2,2000,$3,$4,$5${v.created ? ', $6' : ''})`, [id, v.unit, v.status, v.sp, v.owner, ...(v.created ? [v.created] : [])]);
  };
  const snap = async (id) => (await query('SELECT commission_snapshot AS s, commission_snapshot_status AS st, commission_review_reason AS why FROM reservations WHERE id = $1', [id])).rows[0];

  // Pending -> confirmed captures the APPLIED rates of that moment.
  await R(702);
  ok((await snap(702)).s === null, 'pending reservation: no snapshot yet');
  await query(`UPDATE reservations SET status = 'confirmed' WHERE id = 702`);
  let s = await snap(702);
  ok(Number(s.s.applied.company_pct) === 20 && s.s.applied.company_pct_source === 'unit company %' && Number(s.s.applied.sales_pct) === 10 && s.st === 'captured' && s.s.version === 2,
    'confirming saves the applied company % (20) and salesperson % (10), with source and basis', JSON.stringify(s.s.applied));

  // Retries / repeated confirmations do not re-capture.
  const firstSnap = JSON.stringify(s.s);
  await query(`UPDATE units SET company_commission_pct = 25 WHERE id = $1`, [unit]);
  await query(`UPDATE staff_users SET sales_commission_pct = 15 WHERE id = 801`);
  await query(`UPDATE reservations SET status = 'confirmed' WHERE id = 702`);
  await query(`UPDATE reservations SET status = 'checked_in' WHERE id = 702`);
  await query(`UPDATE reservations SET status = 'pending' WHERE id = 702`);
  await query(`UPDATE reservations SET status = 'confirmed' WHERE id = 702`);
  s = await snap(702);
  ok(JSON.stringify(s.s) === firstSnap && s.st === 'captured', 'retried / repeated confirmations and later rate changes leave the saved snapshot exactly as it was');

  await R(703, { status: 'confirmed' });
  s = await snap(703);
  ok(Number(s.s.applied.company_pct) === 25 && Number(s.s.applied.sales_pct) === 15, 'new rates apply to reservations confirmed after the change');

  // Applied-rate rules mirror calcReservationFinancials.
  const u0 = (await query(`INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, commission_mode) VALUES ('c0','C0','C0-1','published','rent','M','M',1,1,2,0,'A') RETURNING id`)).rows[0].id;
  await R(704, { unit: u0, status: 'confirmed', sp: null });
  s = await snap(704);
  ok(Number(s.s.applied.company_pct) === 20 && /default/.test(s.s.applied.company_pct_source) && s.s.applied.sales_pct === null && s.s.salesperson === null,
    'unit without a company % records the 20% default the engine applies; no salesperson -> no sales %');
  const uc = (await query(`INSERT INTO units (slug, title, unit_number, status, listing_type, compound, project, beds, baths, guests, company_commission_pct, company_commission_owner_pct, commission_tenant_pct, commission_mode) VALUES ('cc','CC','CC-1','published','rent','M','M',1,1,2,22,12,10,'C') RETURNING id`)).rows[0].id;
  await R(705, { unit: uc, status: 'confirmed', owner: 1 });
  await R(706, { unit: uc, status: 'confirmed', owner: 0 });
  const s705 = await snap(705), s706 = await snap(706);
  ok(Number(s705.s.applied.company_pct) === 12 && Number(s705.s.applied.tenant_deduction_pct) === 0 && Number(s706.s.applied.company_pct) === 22 && Number(s706.s.applied.tenant_deduction_pct) === 10,
    'mode C: owner-booked stay uses the owner % with no tenant deduction; guest stay uses company % and tenant %');

  // Nobody can write a snapshot by hand: not on a historical stay, not on insert, not by overwrite.
  ok(await rejects(() => query(`UPDATE reservations SET commission_snapshot = '{"applied":{"company_pct":20}}'::jsonb WHERE id = 701`), /authorised correction/), 'a historical stay cannot be given an invented snapshot');
  ok(await rejects(() => query(`INSERT INTO reservations (id, unit_id, guest_name, guest_phone, check_in, check_out, nights, total_amount, status, commission_snapshot) VALUES (707,$1,'G','0','2026-12-01','2026-12-02',1,1,'confirmed','{}'::jsonb)`, [unit]), /authorised correction/), 'an insert cannot bring its own snapshot');
  ok(await rejects(() => query(`UPDATE reservations SET commission_snapshot = '{}'::jsonb WHERE id = 702`), /authorised correction/), 'a saved snapshot cannot be overwritten directly');
  await query(`UPDATE reservations SET commission_snapshot_status = 'corrected', commission_snapshot_at = now() - interval '9 days' WHERE id = 702`);
  ok((await snap(702)).st === 'captured', 'status / timestamp columns cannot be edited directly (silently kept)');
  ok(await rejects(() => db.exec(`BEGIN; SELECT set_config('app.commission_correction','on',true); UPDATE reservations SET commission_snapshot = '{"applied":{"company_pct":1}}'::jsonb WHERE id = 702; COMMIT;`), /reason/), 'even a raw database correction is refused without who and why');
  await db.exec('ROLLBACK').catch(() => {});

  // Changes that could alter which rate applies -> flagged for review, rates kept.
  await query(`UPDATE reservations SET sales_person_id = NULL WHERE id = 703`);
  await query(`UPDATE reservations SET is_owner_reservation = 1 WHERE id = 706`);
  await query(`UPDATE reservations SET status = 'cancelled' WHERE id = 704`);
  await query(`UPDATE reservations SET status = 'confirmed' WHERE id = 704`);
  const why = (await query(`SELECT reservation_id, review_reason FROM reservation_commission_review WHERE reservation_id IN (703,704,706) ORDER BY 1`)).rows;
  ok(why.length === 3 && /salesperson/.test(why[0].review_reason) && /cancellation/.test(why[1].review_reason) && /owner-booking/.test(why[2].review_reason),
    'salesperson change, owner-flag change and re-confirmation after cancellation are flagged for review', JSON.stringify(why));

  // Created before snapshots began, confirmed now -> captured but flagged.
  await R(708, { created: '2026-01-15T10:00:00Z' });
  await query(`UPDATE reservations SET status = 'confirmed' WHERE id = 708`);
  s = await snap(708);
  ok(s.s && s.st === 'needs_review' && /before rate snapshots/.test(s.why), 'a stay created before snapshots began is captured but flagged (may have been confirmed earlier)');

  // Authorised corrections.
  await query(`INSERT INTO staff_users (id, username, password_hash, full_name, role, is_active) VALUES (901,'a1','x','Admin One','admin',1),(902,'a2','x','Admin Two','admin',1),(903,'r1','x','Res','reservations',1)`);
  ok(await rejects(() => snaps.correctSnapshot({ reservationId: 702, rates: { company_pct: 18 }, reason: 'short', actorId: 901 })), 'a correction needs a real reason');
  ok(await rejects(() => snaps.correctSnapshot({ reservationId: 702, rates: { company_pct: 18 }, reason: 'Contract signed at 18 percent', actorId: 903 }), /admin/), 'a non-admin cannot correct rates');
  ok(await rejects(() => snaps.correctSnapshot({ reservationId: 702, rates: { company_pct: 18 }, reason: 'Contract signed at 18 percent', actorId: 901, approvedBy: 901 }), /different person/), 'nobody approves their own correction');
  const fixed = await snaps.correctSnapshot({ reservationId: 702, rates: { company_pct: '18', sales_pct: '8' }, reason: 'Contract signed at 18%, unit record was wrong', actorId: 901, approvedBy: 902 });
  const log = (await query('SELECT previous, corrected, corrected_by, approved_by, reason FROM reservation_commission_corrections WHERE reservation_id = 702')).rows;
  s = await snap(702);
  ok(fixed.applied.company_pct === '18' && log.length === 1 && Number(log[0].previous.applied.company_pct) === 20 && log[0].corrected_by === 901 && log[0].approved_by === 902 && s.st === 'corrected',
    'authorised correction: saved, status corrected, log has before/after, reason, who and approver', JSON.stringify(log));
  await snaps.correctSnapshot({ reservationId: 701, rates: { company_pct: '20' }, reason: 'Rate confirmed from the signed owner contract', actorId: 901 });
  ok((await snap(701)).st === 'corrected' && !(await query('SELECT 1 FROM reservation_commission_review WHERE reservation_id = 701')).rows.length, 'a reviewed historical stay leaves the review list only through a logged correction');
  ok(await rejects(() => query(`UPDATE reservation_commission_corrections SET reason = 'changed afterwards!!' WHERE reservation_id = 702`), /permanent/), 'the correction log cannot be edited');
  ok(await rejects(() => query(`DELETE FROM reservation_commission_corrections`), /permanent/), 'the correction log cannot be deleted');

  console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('CRASH', e.stack); process.exit(1); });
