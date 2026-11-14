/**
 * Phone clock-in / clock-out.
 *
 * - Staff clock in and out from their phone only, confirming with fingerprint or Face ID (a WebAuthn
 *   passkey on that phone, "user verification required").
 * - Clocking in needs the phone's location within the office area (300 m around the office pin).
 * - While the page is open it keeps checking the location; once the phone is clearly outside the area
 *   the person is clocked out automatically and has to clock in again when they're back.
 * - The first clock-in of the day becomes the attendance check-in (and goes through the lateness rules);
 *   the last clock-out becomes the check-out.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { query } = require('../../config/db');
const { requireRoles } = require('../../middleware/auth');
const { logAudit } = require('../../lib/audit');
const {
  cairoParts,
  computeLatenessDeduction,
  hasOfficeAttendance,
  isScheduledDayOff,
  DEFAULT_ATTENDANCE_CHECKOUT,
  SHIFT_START_MINUTES,
  SHIFT_END_MINUTES,
} = require('../../lib/hrRules');
const { closeEndedShifts } = require('../../lib/clockAutoOut');
const { attendanceHelpers } = require('./hr');

const router = express.Router();
const HR_CLOCK_ROLES = ['admin', 'hr', 'hr_supervisor'];
const MAX_ACCURACY_M = 150;
const CHALLENGE_TTL = '5m';
const PHONE_UA = /Android.+Mobile|iPhone|iPod|Windows Phone|Mobile Safari|Opera Mini|IEMobile/i;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Phones only: laptops, desktops and tablets are refused (the page also checks on the device). */
function isPhoneRequest(req) {
  const ua = String(req.get('user-agent') || '');
  if (/iPad|Tablet|Macintosh|Windows NT|X11|CrOS/i.test(ua) && !/Mobile/i.test(ua)) return false;
  return PHONE_UA.test(ua);
}

function allowedOrigins(req) {
  const list = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '*');
  list.push(`${req.protocol}://${req.get('host')}`);
  return list;
}

/** The website's origin and RP ID; passkeys are tied to the site's domain. */
function relyingParty(req) {
  const origin = String(req.get('origin') || '').replace(/\/$/, '');
  if (!origin || !allowedOrigins(req).includes(origin)) {
    throw new HttpError(400, 'Open the clock-in page from the Soul website on your phone.');
  }
  return { origin, rpID: process.env.WEBAUTHN_RP_ID || new URL(origin).hostname };
}

function challengeToken(userId, challenge, purpose) {
  return jwt.sign({ sub: String(userId), ch: challenge, p: purpose }, process.env.JWT_SECRET, { expiresIn: CHALLENGE_TTL });
}

function readChallenge(token, userId, purpose) {
  try {
    const payload = jwt.verify(String(token || ''), process.env.JWT_SECRET);
    if (payload.sub !== String(userId) || payload.p !== purpose) throw new Error('mismatch');
    return payload.ch;
  } catch {
    throw new HttpError(400, 'That took too long. Please try again.');
  }
}

/** Distance in metres between two coordinates (haversine). */
function distanceMeters(a, b) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function readLocation(body) {
  const lat = Number(body?.location?.lat);
  const lng = Number(body?.location?.lng);
  const accuracy = Number(body?.location?.accuracy);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'Your location is needed. Allow location for this site and try again.');
  }
  return { lat, lng, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null };
}

async function activeSite() {
  const { rows } = await query(
    `SELECT id, name, lat, lng, radius_m FROM attendance_sites WHERE active = true ORDER BY id LIMIT 1`
  );
  if (!rows[0]) throw new HttpError(500, 'No office location is set up yet.');
  return { ...rows[0], lat: Number(rows[0].lat), lng: Number(rows[0].lng), radius_m: Number(rows[0].radius_m) };
}

function hhmm(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

async function loadMe(userId) {
  const { rows } = await query(
    `SELECT id, full_name, role, staff_code, COALESCE(base_salary, 0)::float AS base_salary,
            COALESCE(days_off, '{}') AS days_off, COALESCE(office_attendance_exempt, false) AS office_attendance_exempt
     FROM staff_users WHERE id = $1 AND COALESCE(is_active, 1)::int = 1`,
    [userId]
  );
  if (!rows[0]) throw new HttpError(404, 'Staff member not found');
  return rows[0];
}

async function todayEvents(staffId, date) {
  const { rows } = await query(
    `SELECT id, kind, source, at, distance_m FROM staff_clock_events
     WHERE staff_user_id = $1 AND work_date = $2::date ORDER BY at, id`,
    [staffId, date]
  );
  return rows;
}

const isOpen = (events) => events.length > 0 && events[events.length - 1].kind === 'in';

async function credentialsFor(staffId) {
  const { rows } = await query(
    `SELECT id, credential_id, public_key, counter, transports, device_label, created_at, last_used_at
     FROM staff_webauthn_credentials WHERE staff_user_id = $1 ORDER BY id`,
    [staffId]
  );
  return rows;
}

async function statusPayload(req, me) {
  const { date, minutes } = cairoParts();
  const [site, events, creds, attendance] = await Promise.all([
    activeSite(),
    todayEvents(me.id, date),
    credentialsFor(me.id),
    query(
      `SELECT check_in::text AS check_in, check_out::text AS check_out
       FROM staff_attendance WHERE staff_user_id = $1 AND work_date = $2::date`,
      [me.id, date]
    ),
  ]);
  const a = attendance.rows[0];
  return {
    today: date,
    now: hhmm(minutes),
    site: { name: site.name, lat: site.lat, lng: site.lng, radius_m: site.radius_m },
    shift: { start: hhmm(SHIFT_START_MINUTES), end: DEFAULT_ATTENDANCE_CHECKOUT },
    day_off: isScheduledDayOff(me.days_off, date),
    office_attendance: hasOfficeAttendance(me.role) && !me.office_attendance_exempt,
    is_phone: isPhoneRequest(req),
    clocked_in: isOpen(events),
    events: events.map((e) => ({ kind: e.kind, source: e.source, at: e.at, distance_m: e.distance_m != null ? Math.round(Number(e.distance_m)) : null })),
    device: creds[0] ? { label: creds[0].device_label, since: creds[0].created_at, last_used_at: creds[0].last_used_at } : null,
    // Staff see their times only; lateness status and penalties stay with HR.
    attendance: a ? { check_in: a.check_in ? a.check_in.slice(0, 5) : null, check_out: a.check_out ? a.check_out.slice(0, 5) : null } : null,
  };
}

/** CEOs don't clock in; they see everyone's clock-ins instead. */
function staffOnly(req) {
  if (req.user?.role === 'admin') throw new HttpError(403, 'CEOs don’t clock in.');
}

function handle(fn) {
  return async (req, res, next) => {
    try {
      if (!req.user || req.user.role === 'owner') throw new HttpError(403, 'Only staff can clock in.');
      await fn(req, res);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  };
}

router.get('/clock/status', handle(async (req, res) => {
  // A forgotten clock-out closes at the shift end even if the background job hasn't run yet.
  if (req.user.role !== 'admin') await closeEndedShifts({ staffId: req.user.id }).catch(() => 0);
  res.json(await statusPayload(req, await loadMe(req.user.id)));
}));

// ── Registering this phone's fingerprint / Face ID ──

router.post('/clock/passkey/options', handle(async (req, res) => {
  staffOnly(req);
  if (!isPhoneRequest(req)) throw new HttpError(403, 'Set up clock-in from your phone.');
  const me = await loadMe(req.user.id);
  const existing = await credentialsFor(me.id);
  // One phone per person stops someone clocking in for a colleague from another phone; HR can reset it.
  if (existing.length) throw new HttpError(409, 'A phone is already set up for you. Ask HR to reset it if you changed phones.');
  const { rpID } = relyingParty(req);
  const options = await generateRegistrationOptions({
    rpName: 'Soul',
    rpID,
    userName: me.staff_code || `staff-${me.id}`,
    userDisplayName: me.full_name,
    userID: new TextEncoder().encode(`staff-${me.id}`),
    attestationType: 'none',
    timeout: 120000,
    authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
  });
  res.json({ options, token: challengeToken(me.id, options.challenge, 'register') });
}));

router.post('/clock/passkey/register', handle(async (req, res) => {
  staffOnly(req);
  if (!isPhoneRequest(req)) throw new HttpError(403, 'Set up clock-in from your phone.');
  const me = await loadMe(req.user.id);
  if ((await credentialsFor(me.id)).length) throw new HttpError(409, 'A phone is already set up for you.');
  const expectedChallenge = readChallenge(req.body?.token, me.id, 'register');
  const { origin, rpID } = relyingParty(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body?.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new HttpError(400, `Could not set up fingerprint / Face ID: ${err.message}`);
  }
  if (!verification.verified || !verification.registrationInfo) throw new HttpError(400, 'Could not set up fingerprint / Face ID.');
  const { credential } = verification.registrationInfo;
  const label = String(req.body?.label || '').slice(0, 80) || null;
  await query(
    `INSERT INTO staff_webauthn_credentials (staff_user_id, credential_id, public_key, counter, transports, device_label)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [me.id, credential.id, Buffer.from(credential.publicKey).toString('base64url'), credential.counter || 0, credential.transports || [], label]
  );
  await logAudit({ userId: me.id, action: 'CLOCK_DEVICE_REGISTER', entityType: 'staff_user', entityId: me.id, details: { name: me.full_name, device: label } });
  res.status(201).json(await statusPayload(req, me));
}));

// ── Clocking in and out ──

router.post('/clock/options', handle(async (req, res) => {
  staffOnly(req);
  if (!isPhoneRequest(req)) throw new HttpError(403, 'Clock in from your phone.');
  const me = await loadMe(req.user.id);
  const creds = await credentialsFor(me.id);
  if (!creds.length) throw new HttpError(409, 'Set up fingerprint / Face ID on this phone first.');
  const { rpID } = relyingParty(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'required',
    timeout: 120000,
    allowCredentials: creds.map((c) => ({ id: c.credential_id, transports: c.transports || undefined })),
  });
  res.json({ options, token: challengeToken(me.id, options.challenge, 'punch') });
}));

/** First clock-in of the day → attendance check-in (lateness rules apply); later ones just reopen the day. */
async function recordClockIn(me, date, minutes) {
  const { rows } = await query(
    `SELECT status, check_in::text AS check_in FROM staff_attendance WHERE staff_user_id = $1 AND work_date = $2::date`,
    [me.id, date]
  );
  const row = rows[0];
  if (row) {
    if (row.check_in) {
      await query(`UPDATE staff_attendance SET check_out = NULL, updated_at = now() WHERE staff_user_id = $1 AND work_date = $2::date`, [me.id, date]);
    }
    return; // HR already set this day (leave, WFH, day off, or a manual entry).
  }
  const arrival = hhmm(minutes);
  let status = 'on_time';
  if (!isScheduledDayOff(me.days_off, date) && computeLatenessDeduction(me.base_salary, arrival).factor > 0) {
    // An approved excuse or mission that starts at the beginning of the shift covers a late arrival.
    const { rows: covered } = await query(
      `SELECT 1 FROM staff_leave_requests
       WHERE staff_user_id = $1 AND status = 'approved' AND start_date = $2::date
         AND leave_type IN ('paid_excuse', 'unpaid_excuse', 'early_leave', 'mission')
         AND start_time <= $3::time AND end_time >= $4::time
       LIMIT 1`,
      [me.id, date, hhmm(SHIFT_START_MINUTES + 15), arrival]
    );
    status = covered[0] ? 'on_time' : 'late';
  }
  await attendanceHelpers.upsertAttendanceRecord({
    staff: me,
    date,
    status,
    checkIn: arrival,
    checkOut: null,
    amount: status === 'on_time' ? 0 : null,
    notified: null,
    actorId: me.id,
  });
}

async function recordClockOut(me, date, minutes) {
  await query(
    `UPDATE staff_attendance SET check_out = $3::time, updated_at = now()
     WHERE staff_user_id = $1 AND work_date = $2::date AND check_in IS NOT NULL`,
    [me.id, date, hhmm(minutes)]
  );
}

router.post('/clock/punch', handle(async (req, res) => {
  staffOnly(req);
  if (!isPhoneRequest(req)) throw new HttpError(403, 'Clock in from your phone.');
  const action = req.body?.action === 'out' ? 'out' : 'in';
  const me = await loadMe(req.user.id);
  const location = readLocation(req.body);
  if (location.accuracy != null && location.accuracy > MAX_ACCURACY_M) {
    throw new HttpError(400, `Your location isn’t precise enough (about ${Math.round(location.accuracy)} m). Turn on precise location and try again.`);
  }
  if (action === 'in' && cairoParts().minutes >= SHIFT_END_MINUTES) {
    throw new HttpError(403, `Your shift ended at ${DEFAULT_ATTENDANCE_CHECKOUT}. You can clock in again tomorrow (early is fine).`);
  }
  const site = await activeSite();
  const distance = distanceMeters(site, location);
  if (action === 'in' && distance > site.radius_m) {
    throw new HttpError(403, `You’re ${Math.round(distance)} m from the office. Clock in when you’re within ${site.radius_m} m.`);
  }

  // Fingerprint / Face ID: the phone signs our challenge only after the person is verified.
  const expectedChallenge = readChallenge(req.body?.token, me.id, 'punch');
  const response = req.body?.response;
  const creds = await credentialsFor(me.id);
  const cred = creds.find((c) => c.credential_id === response?.id);
  if (!cred) throw new HttpError(403, 'This isn’t the phone set up for your clock-in.');
  const { origin, rpID } = relyingParty(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: cred.credential_id,
        publicKey: new Uint8Array(Buffer.from(cred.public_key, 'base64url')),
        counter: Number(cred.counter) || 0,
        transports: cred.transports || undefined,
      },
    });
  } catch (err) {
    throw new HttpError(403, `Fingerprint / Face ID check failed: ${err.message}`);
  }
  if (!verification.verified) throw new HttpError(403, 'Fingerprint / Face ID check failed.');
  await query(
    `UPDATE staff_webauthn_credentials SET counter = $2, last_used_at = now() WHERE id = $1`,
    [cred.id, verification.authenticationInfo.newCounter || 0]
  );

  const { date, minutes } = cairoParts();
  const events = await todayEvents(me.id, date);
  if (action === 'in' && isOpen(events)) throw new HttpError(409, 'You’re already clocked in.');
  if (action === 'out' && !isOpen(events)) throw new HttpError(409, 'You’re not clocked in.');

  await query(
    `INSERT INTO staff_clock_events (staff_user_id, work_date, kind, source, lat, lng, accuracy_m, distance_m, site_id, user_agent, credential_id)
     VALUES ($1, $2::date, $3, 'biometric', $4, $5, $6, $7, $8, $9, $10)`,
    [me.id, date, action, location.lat, location.lng, location.accuracy, distance, site.id, String(req.get('user-agent') || '').slice(0, 300), cred.credential_id]
  );
  if (action === 'in') await recordClockIn(me, date, minutes);
  else await recordClockOut(me, date, minutes);
  res.json(await statusPayload(req, me));
}));

/**
 * Called by the open page whenever it sees the phone outside the area. The server re-checks the
 * distance and only clocks out when the phone is clearly outside (distance minus accuracy > radius).
 */
router.post('/clock/left-area', handle(async (req, res) => {
  staffOnly(req);
  const me = await loadMe(req.user.id);
  const location = readLocation(req.body);
  const site = await activeSite();
  const distance = distanceMeters(site, location);
  const margin = Math.min(location.accuracy ?? 0, site.radius_m);
  const { date, minutes } = cairoParts();
  const events = await todayEvents(me.id, date);
  if (!isOpen(events) || distance - margin <= site.radius_m) {
    return res.json({ clocked_out: false, distance_m: Math.round(distance), ...(await statusPayload(req, me)) });
  }
  await query(
    `INSERT INTO staff_clock_events (staff_user_id, work_date, kind, source, lat, lng, accuracy_m, distance_m, site_id, user_agent)
     VALUES ($1, $2::date, 'out', 'left_area', $3, $4, $5, $6, $7, $8)`,
    [me.id, date, location.lat, location.lng, location.accuracy, distance, site.id, String(req.get('user-agent') || '').slice(0, 300)]
  );
  await recordClockOut(me, date, minutes);
  await logAudit({
    userId: me.id,
    action: 'CLOCK_AUTO_OUT',
    entityType: 'staff_user',
    entityId: me.id,
    details: { name: me.full_name, distance_m: Math.round(distance), at: hhmm(minutes) },
  });
  res.json({ clocked_out: true, distance_m: Math.round(distance), ...(await statusPayload(req, me)) });
}));

// ── HR: who is in, phones, and the office location ──

router.get('/clock/team', requireRoles(...HR_CLOCK_ROLES), handle(async (_req, res) => {
  const { date } = cairoParts();
  const [staff, events, creds, site] = await Promise.all([
    query(
      `SELECT id, full_name, role, staff_code, COALESCE(office_attendance_exempt, false) AS office_attendance_exempt
       FROM staff_users WHERE COALESCE(is_active, 1)::int = 1 AND role NOT IN ('owner', 'admin') ORDER BY full_name`
    ),
    query(`SELECT staff_user_id, kind, source, at FROM staff_clock_events WHERE work_date = $1::date ORDER BY at, id`, [date]),
    query(`SELECT staff_user_id, device_label, created_at, last_used_at FROM staff_webauthn_credentials`),
    activeSite(),
  ]);
  const byStaff = new Map();
  for (const e of events.rows) {
    if (!byStaff.has(e.staff_user_id)) byStaff.set(e.staff_user_id, []);
    byStaff.get(e.staff_user_id).push(e);
  }
  const device = new Map(creds.rows.map((c) => [c.staff_user_id, c]));
  res.json({
    today: date,
    site,
    staff: staff.rows
      .filter((s) => hasOfficeAttendance(s.role) && !s.office_attendance_exempt)
      .map((s) => {
        const list = byStaff.get(s.id) || [];
        return {
          id: s.id,
          full_name: s.full_name,
          role: s.role,
          staff_code: s.staff_code,
          clocked_in: isOpen(list),
          first_in: list.find((e) => e.kind === 'in')?.at || null,
          last_out: [...list].reverse().find((e) => e.kind === 'out')?.at || null,
          auto_outs: list.filter((e) => e.source === 'left_area').length,
          shift_end_outs: list.filter((e) => e.source === 'shift_end').length,
          device: device.get(s.id) || null,
        };
      }),
  });
}));

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everyone's clock-ins for a date range, one row per person per day: first in, last out, each
 * in/out pair, time inside, and automatic clock-outs. Filter by person (id or name) and dates.
 */
router.get('/clock/history', requireRoles(...HR_CLOCK_ROLES), handle(async (req, res) => {
  const { date: today } = cairoParts();
  const to = ISO_DAY.test(String(req.query.to || '')) ? String(req.query.to) : today;
  const from = ISO_DAY.test(String(req.query.from || '')) ? String(req.query.from) : to;
  if (from > to) throw new HttpError(400, 'The start date must be before the end date');
  const span = Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1;
  if (span > 93) throw new HttpError(400, 'Choose up to 3 months at a time');
  const params = [from, to];
  const where = ['e.work_date BETWEEN $1::date AND $2::date'];
  const staffId = Number(req.query.staff_id);
  if (Number.isInteger(staffId) && staffId > 0) {
    params.push(staffId);
    where.push(`e.staff_user_id = $${params.length}`);
  }
  const name = String(req.query.q || '').trim();
  if (name) {
    params.push(`%${name}%`);
    where.push(`(u.full_name ILIKE $${params.length} OR u.staff_code ILIKE $${params.length})`);
  }
  const [events, staff] = await Promise.all([
    query(
      `SELECT e.staff_user_id, e.work_date::text AS work_date, e.kind, e.source, e.at, u.full_name, u.role, u.staff_code
       FROM staff_clock_events e JOIN staff_users u ON u.id = e.staff_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY e.work_date DESC, u.full_name, e.at, e.id`,
      params
    ),
    query(
      `SELECT id, full_name, role, staff_code FROM staff_users
       WHERE COALESCE(is_active, 1)::int = 1 AND role NOT IN ('owner', 'admin') ORDER BY full_name`
    ),
  ]);
  const days = new Map();
  for (const e of events.rows) {
    const key = `${e.staff_user_id}|${e.work_date}`;
    if (!days.has(key)) {
      days.set(key, { staff_user_id: e.staff_user_id, full_name: e.full_name, role: e.role, staff_code: e.staff_code, date: e.work_date, events: [] });
    }
    days.get(key).events.push(e);
  }
  const rows = [...days.values()].map((d) => {
    const sessions = [];
    for (const e of d.events) {
      if (e.kind === 'in') sessions.push({ in: e.at, out: null, out_source: null });
      else if (sessions.length && !sessions[sessions.length - 1].out) {
        sessions[sessions.length - 1].out = e.at;
        sessions[sessions.length - 1].out_source = e.source;
      }
    }
    const open = sessions.length > 0 && !sessions[sessions.length - 1].out;
    let minutesIn = 0;
    for (const s of sessions) {
      const end = s.out ? new Date(s.out) : d.date === today ? new Date() : null;
      if (end) minutesIn += Math.max(0, Math.round((end - new Date(s.in)) / 60000));
    }
    return {
      staff_user_id: d.staff_user_id,
      full_name: d.full_name,
      role: d.role,
      staff_code: d.staff_code,
      date: d.date,
      first_in: sessions[0]?.in || null,
      last_out: [...sessions].reverse().find((s) => s.out)?.out || null,
      sessions,
      still_in: open && d.date === today,
      forgot_out: open && d.date !== today,
      minutes_in: minutesIn,
      auto_outs: d.events.filter((e) => e.source === 'left_area').length,
      shift_end_outs: d.events.filter((e) => e.source === 'shift_end').length,
    };
  });
  res.json({ from, to, today, staff: staff.rows, rows });
}));

router.delete('/clock/devices/:staffId', requireRoles(...HR_CLOCK_ROLES), handle(async (req, res) => {
  const staffId = Number(req.params.staffId);
  const { rows } = await query(`DELETE FROM staff_webauthn_credentials WHERE staff_user_id = $1 RETURNING device_label`, [staffId]);
  const { rows: who } = await query(`SELECT full_name FROM staff_users WHERE id = $1`, [staffId]);
  await logAudit({
    userId: req.user.id,
    action: 'CLOCK_DEVICE_RESET',
    entityType: 'staff_user',
    entityId: staffId,
    details: { name: who[0]?.full_name, removed: rows.length },
  });
  res.json({ ok: true, removed: rows.length });
}));

router.put('/clock/site', requireRoles(...HR_CLOCK_ROLES), handle(async (req, res) => {
  const lat = Number(req.body?.lat);
  const lng = Number(req.body?.lng);
  const radius = Math.round(Number(req.body?.radius_m));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new HttpError(400, 'Enter a valid latitude and longitude');
  }
  if (!(radius >= 50 && radius <= 5000)) throw new HttpError(400, 'The area must be between 50 and 5000 m');
  const before = await activeSite();
  const { rows } = await query(
    `UPDATE attendance_sites SET lat = $2, lng = $3, radius_m = $4, name = COALESCE(NULLIF($5, ''), name)
     WHERE id = $1 RETURNING id, name, lat, lng, radius_m`,
    [before.id, lat, lng, radius, String(req.body?.name || '').slice(0, 80)]
  );
  await logAudit({ userId: req.user.id, action: 'CLOCK_SITE_UPDATE', entityType: 'attendance_site', entityId: before.id, details: { name: rows[0].name, before, after: rows[0] } });
  res.json(rows[0]);
}));

router._test = { distanceMeters, isPhoneRequest };

module.exports = router;
