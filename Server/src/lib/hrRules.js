const { namesAreAliases } = require('./salesNameMatch');

const DAYS_IN_MONTH = 30;
const SHIFT_START_MINUTES = 11 * 60;
const GRACE_END_MINUTES = 11 * 60 + 15;
const LATE_QUARTER_END = 11 * 60 + 30;
const LATE_HALF_END = 12 * 60;
const ANNUAL_MIN_NOTICE_DAYS = 7;
const EARLY_LEAVE_MAX_PER_YEAR = 2;
const TIMEZONE = 'Africa/Cairo';

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function dailyRate(baseSalary) {
  const salary = Number(baseSalary) || 0;
  return roundMoney(salary / DAYS_IN_MONTH);
}

function parseHhMm(value) {
  const text = String(value || '').trim();
  const m = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/** @returns {{ factor: number, band: string, label: string } | { factor: 0, band: 'grace', label: string }} */
function latenessFactor(arrivalMinutes) {
  if (!Number.isFinite(arrivalMinutes)) {
    const err = new Error('Arrival time is required for lateness');
    err.status = 400;
    throw err;
  }
  if (arrivalMinutes <= GRACE_END_MINUTES) {
    return {
      factor: 0,
      band: 'grace',
      label: 'On time (11:00–11:15, no deduction)',
    };
  }
  if (arrivalMinutes <= LATE_QUARTER_END) {
    return {
      factor: 0.25,
      band: 'quarter',
      label: '11:16–11:30 · 0.25 × daily rate',
    };
  }
  if (arrivalMinutes <= LATE_HALF_END) {
    return {
      factor: 0.5,
      band: 'half',
      label: '11:31–12:00 · 0.5 × daily rate',
    };
  }
  return {
    factor: 1,
    band: 'full',
    label: 'After 12:00 PM · 1 × daily rate',
  };
}

function absenceFactor(notified) {
  return notified ? 1 : 2;
}

function computeLatenessDeduction(baseSalary, arrivalTime) {
  const minutes = typeof arrivalTime === 'number' ? arrivalTime : parseHhMm(arrivalTime);
  if (minutes == null) {
    const err = new Error('Arrival time must be HH:MM');
    err.status = 400;
    throw err;
  }
  const rate = dailyRate(baseSalary);
  const late = latenessFactor(minutes);
  return {
    ...late,
    daily_rate: rate,
    amount: roundMoney(rate * late.factor),
    arrival_minutes: minutes,
  };
}

function computeAbsenceDeduction(baseSalary, notified) {
  const rate = dailyRate(baseSalary);
  const factor = absenceFactor(!!notified);
  return {
    factor,
    daily_rate: rate,
    amount: roundMoney(rate * factor),
    notified: !!notified,
    label: notified
      ? 'Absence with notice · 1 × daily rate'
      : 'Absence without notice · 2 × daily rate',
  };
}

function cairoParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function assertCasualTiming(startDate, now = new Date()) {
  const cairo = cairoParts(now);
  if (startDate < cairo.date) {
    const err = new Error('Casual leave cannot be requested for a past date');
    err.status = 400;
    throw err;
  }
  if (startDate === cairo.date && cairo.minutes >= SHIFT_START_MINUTES) {
    const err = new Error('Casual leave must be requested before the 11:00 AM shift');
    err.status = 400;
    throw err;
  }
}

function assertAnnualNotice(startDate, now = new Date()) {
  const cairo = cairoParts(now);
  const minDate = addDaysIso(cairo.date, ANNUAL_MIN_NOTICE_DAYS);
  if (startDate < minDate) {
    const err = new Error(`Annual leave must be requested at least ${ANNUAL_MIN_NOTICE_DAYS} days in advance`);
    err.status = 400;
    throw err;
  }
}

function assertEarlyLeaveTiming(startDate, now = new Date()) {
  const cairo = cairoParts(now);
  if (startDate < cairo.date) {
    const err = new Error('Early leave cannot be requested for a past date');
    err.status = 400;
    throw err;
  }
}

const HOLIDAY_ACCESS_MONTHS = 6;

function monthsBetween(fromDate, toDate) {
  const from = fromDate instanceof Date ? fromDate : new Date(fromDate);
  const to = toDate instanceof Date ? toDate : new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  const years = to.getFullYear() - from.getFullYear();
  const months = to.getMonth() - from.getMonth();
  let total = years * 12 + months;
  if (to.getDate() < from.getDate()) total -= 1;
  return total;
}

function canRequestHolidays({ holiday_access, created_at }, now = new Date()) {
  const mode = String(holiday_access || 'auto').toLowerCase();
  if (mode === 'granted') return true;
  if (mode === 'denied') return false;
  return monthsBetween(created_at, now) >= HOLIDAY_ACCESS_MONTHS;
}

const HR_TEAM_ROLES = ['hr', 'hr_supervisor'];

function isHrTeamRole(role) {
  return HR_TEAM_ROLES.includes(String(role || ''));
}

function isHrActingOnSelf(actor, targetUserId) {
  return isHrTeamRole(actor?.role) && targetUserId != null && String(actor.id) === String(targetUserId);
}

function appliesSalaryImmediately(actor) {
  return actor?.role === 'admin' || actor?.role === 'hr_supervisor';
}

function canEditStaffCompensation(actor, targetUserId) {
  if (!actor) return false;
  if (actor.role === 'admin') return true;
  if (actor.role === 'hr_supervisor') {
    return targetUserId == null || String(actor.id) !== String(targetUserId);
  }
  return false;
}

function assertCanEditStaffCompensation(
  actor,
  targetUserId,
  label = 'salary, holiday balances, or holiday access'
) {
  if (canEditStaffCompensation(actor, targetUserId)) return;
  if (isHrActingOnSelf(actor, targetUserId)) {
    const err = new Error(`Only an admin can change your ${label}`);
    err.status = 403;
    throw err;
  }
  const err = new Error(`Only an HR Supervisor or admin can change ${label}`);
  err.status = 403;
  throw err;
}

function assertHrNotEditingOwnCompensation(
  actor,
  targetUserId,
  label = 'salary, holiday balances, or holiday access'
) {
  if (!isHrActingOnSelf(actor, targetUserId)) return;
  const err = new Error(`Only an admin can change your ${label}`);
  err.status = 403;
  throw err;
}

function nextPayrollPeriod(isoDate) {
  const [y, m] = String(isoDate).slice(0, 10).split('-').map(Number);
  if (m === 12) return { year: y + 1, month: 1, deductionDate: `${y + 1}-01-01` };
  return {
    year: y,
    month: m + 1,
    deductionDate: `${y}-${String(m + 1).padStart(2, '0')}-01`,
  };
}

function dateCoveredByRanges(isoDate, ranges = []) {
  return ranges.some((r) => r.start_date <= isoDate && isoDate <= r.end_date);
}

function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const utc = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  const d = new Date(utc);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function excelTimeToHhMm(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  if (typeof value === 'number' && value >= 0 && value < 1.5) {
    const mins = Math.round((value % 1) * 24 * 60);
    const hh = Math.floor(mins / 60) % 24;
    const mm = mins % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  const text = String(value || '').trim();
  const stamp = text.match(/(?:^|[ T])(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (stamp) {
    const hh = Number(stamp[1]);
    const mm = Number(stamp[2]);
    if (hh <= 23 && mm <= 59) {
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }
  const parsed = parseHhMm(value);
  if (parsed == null) return null;
  const hh = Math.floor(parsed / 60);
  const mm = parsed % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function toIsoDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'number') return excelSerialToIso(value);
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function normalizePersonId(value) {
  return String(value || '')
    .trim()
    .replace(/^'+/, '')
    .replace(/\.0$/, '')
    .trim();
}

function matchAttendanceStaff(row, staffList) {
  const list = staffList || [];
  const code = normalizePersonId(row?.staff_code).toLowerCase();
  if (code && /^\d+$/.test(code)) {
    const byId = list.filter((s) => String(s.id) === code);
    if (byId.length === 1) return byId[0];
  }
  if (code) {
    const byCode = list.filter(
      (s) => normalizePersonId(s.staff_code).toLowerCase() === code
    );
    if (byCode.length === 1) return byCode[0];
  }
  const name = String(row?.name || '').trim();
  if (!name) return null;
  const exact = list.filter(
    (s) => String(s.full_name || '').trim().toLowerCase() === name.toLowerCase()
  );
  if (exact.length === 1) return exact[0];
  const aliased = list.filter((s) => namesAreAliases(s.full_name, name));
  if (aliased.length === 1) return aliased[0];
  const n = name.toLowerCase();
  const prefix = list.filter((s) => {
    const full = String(s.full_name || '').trim().toLowerCase();
    return full === n || full.startsWith(`${n} `) || n.startsWith(`${full} `);
  });
  if (prefix.length === 1) return prefix[0];
  return null;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function truthyNotice(value) {
  const t = String(value || '').trim().toLowerCase();
  return ['1', 'yes', 'y', 'true', 'notified', 'with notice', 'with_notice'].includes(t);
}

function stripHtmlCell(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .trim();
}

function parseHtmlExcelTables(html) {
  const rowCells = String(html)
    .split(/<\/tr>/i)
    .map((frag) =>
      [...frag.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripHtmlCell(m[1]))
    )
    .filter((cells) => cells.length > 0);

  const headerRowIdx = rowCells.findIndex(
    (cells) =>
      cells.some((c) => /^(person|personal)\s*id$/i.test(c)) &&
      cells.some((c) => /^time$/i.test(c)) &&
      cells.some((c) => /^attendance\s*status$/i.test(c))
  );
  if (headerRowIdx >= 0) {
    const headers = rowCells[headerRowIdx];
    const rows = [];
    for (let r = headerRowIdx + 1; r < rowCells.length; r += 1) {
      const cells = rowCells[r];
      if (cells.length < 3) continue;
      const obj = {};
      const n = Math.min(headers.length, cells.length);
      for (let c = 0; c < n; c += 1) obj[headers[c]] = cells[c];
      const person = normalizePersonId(obj[headers[0]]);
      if (!person || /^(person|personal)\s*id$/i.test(person)) continue;
      rows.push(obj);
    }
    if (rows.length) return rows;
  }

  const cells = rowCells.flat();
  const headerIdx = cells.findIndex((c) => /^(person|personal)\s*id$/i.test(c));
  if (headerIdx < 0) return [];
  const headers = [];
  let i = headerIdx;
  while (i < cells.length && headers.length < 11) {
    headers.push(cells[i]);
    i += 1;
  }
  const colCount = headers.length;
  if (colCount < 3) return [];
  const rows = [];
  while (i + colCount <= cells.length) {
    const obj = {};
    for (let c = 0; c < colCount; c += 1) obj[headers[c]] = cells[i + c];
    rows.push(obj);
    i += colCount;
  }
  return rows;
}

function parseAttendanceRows(rows) {
  return (rows || []).map((row, index) => {
    const keys = Object.keys(row || {});
    const pick = (...aliases) => {
      for (const alias of aliases) {
        const key = keys.find((k) => normalizeHeader(k) === alias);
        if (key != null && row[key] != null && String(row[key]).trim() !== '') return row[key];
      }
      return null;
    };
    const timeRaw = pick('time', 'arrival_time', 'arrival', 'check_in', 'checkin', 'clock_in');
    let dateVal = toIsoDate(pick('date', 'day', 'attendance_date')) || toIsoDate(timeRaw);
    const status = String(pick('attendance_status', 'status', 'type', 'attendance') || '').toLowerCase();
    const isCheckIn = /(?:check|clock|overtime)[\s_-]*in/.test(status);
    const isCheckOut = /(?:check|clock|overtime)[\s_-]*out/.test(status);
    const arrival_time = timeRaw != null ? excelTimeToHhMm(timeRaw) : null;
    const explicitAbsent = /absent|absence|no.show/.test(status);
    const absent = explicitAbsent || (!isCheckIn && !isCheckOut && !arrival_time);
    const staffCode = normalizePersonId(
      pick('person_id', 'personal_id', 'staff_code', 'staff_id', 'code')
    );
    const name = pick('name', 'full_name', 'staff', 'employee');
    return {
      row: index + 2,
      staff_code: staffCode,
      name: name ? String(name).trim() : '',
      date: dateVal,
      arrival_time: absent ? null : arrival_time,
      notified: truthyNotice(pick('notified', 'notice', 'with_notice')),
      absent,
      status,
      is_check_in: isCheckIn,
      is_check_out: isCheckOut,
    };
  });
}

function isDoorPunchLog(rows) {
  return (rows || []).some((r) => r.is_check_in || r.is_check_out);
}

function timeToMinutes(hhmm) {
  return parseHhMm(hhmm);
}

function collapsePunchAttendance(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row.staff_code || !row.date) continue;
    const key = `${row.staff_code.toLowerCase()}|${row.date}`;
    const cur = byKey.get(key) || {
      staff_code: row.staff_code,
      name: row.name,
      date: row.date,
      checkIns: [],
      checkOuts: [],
      punches: [],
      notified: false,
      explicitAbsent: false,
    };
    if (row.name && !cur.name) cur.name = row.name;
    if (row.notified) cur.notified = true;
    if (row.absent && !row.is_check_in && !row.is_check_out) cur.explicitAbsent = true;
    if (row.arrival_time) {
      cur.punches.push(row.arrival_time);
      if (row.is_check_in) cur.checkIns.push(row.arrival_time);
      if (row.is_check_out) cur.checkOuts.push(row.arrival_time);
    }
    byKey.set(key, cur);
  }
  return [...byKey.values()].map((cur) => {
    const pickEarliest = (times) =>
      times
        .slice()
        .sort((a, b) => (timeToMinutes(a) ?? 0) - (timeToMinutes(b) ?? 0))[0] || null;
    const pickLatest = (times) =>
      times
        .slice()
        .sort((a, b) => (timeToMinutes(b) ?? 0) - (timeToMinutes(a) ?? 0))[0] || null;
    const arrival = pickEarliest(cur.checkIns) || pickEarliest(cur.punches);
    let check_out = pickLatest(cur.checkOuts);
    if (!check_out && cur.punches.length > 1) {
      const last = pickLatest(cur.punches);
      if (last && last !== arrival) check_out = last;
    }
    const absent = cur.explicitAbsent && !arrival;
    return {
      staff_code: cur.staff_code,
      name: cur.name,
      date: cur.date,
      arrival_time: absent ? null : arrival,
      check_out: absent ? null : check_out,
      notified: cur.notified,
      absent,
    };
  });
}

function fillMissingOfficeAbsences(dailyRows, staffList) {
  const workDates = new Set();
  const present = new Set();
  for (const row of dailyRows || []) {
    const staff = matchAttendanceStaff(row, staffList);
    if (!staff || !hasOfficeAttendance(staff.role) || !row.date) continue;
    present.add(`${staff.id}|${row.date}`);
    if (!row.absent) workDates.add(row.date);
  }
  const extra = [];
  for (const staff of staffList || []) {
    if (!hasOfficeAttendance(staff.role)) continue;
    for (const date of workDates) {
      const key = `${staff.id}|${date}`;
      if (present.has(key)) continue;
      extra.push({
        staff_code: String(staff.id),
        name: staff.full_name,
        date,
        arrival_time: null,
        check_out: null,
        notified: false,
        absent: true,
      });
      present.add(key);
    }
  }
  return extra;
}

function computeHalfDayDeduction(baseSalary) {
  const rate = dailyRate(baseSalary);
  return {
    daily_rate: rate,
    days_factor: 0.5,
    amount: roundMoney(rate * 0.5),
    label: 'Work from home · 0.5 × daily rate',
  };
}

const PENALTY_CATEGORIES = ['lateness', 'absence', 'delay', 'performance', 'penalty'];
const NO_OFFICE_ATTENDANCE_ROLES = new Set([
  'admin',
  'owner',
  'hr_supervisor',
  'operations',
  'operations_supervisor',
]);
const NO_STAFF_BENEFIT_ROLES = new Set(['admin', 'owner']);

function hasOfficeAttendance(role) {
  return !NO_OFFICE_ATTENDANCE_ROLES.has(String(role || ''));
}

function isFieldOperationsRole(role) {
  const r = String(role || '');
  return r === 'operations' || r === 'operations_supervisor';
}

function canRequestStaffBenefits(role) {
  return !NO_STAFF_BENEFIT_ROLES.has(String(role || ''));
}

function staffRequestPolicy(role) {
  const r = String(role || '');
  if (!canRequestStaffBenefits(r)) {
    return { canRequest: false, needsManager: false, needsHr: false };
  }
  if (r === 'hr') return { canRequest: true, needsManager: false, needsHr: true };
  if (r === 'hr_supervisor') return { canRequest: true, needsManager: true, needsHr: false };
  return { canRequest: true, needsManager: true, needsHr: true };
}

function departmentManagerRole(role) {
  switch (String(role || '')) {
    case 'operations':
      return 'operations_supervisor';
    case 'housekeeping':
      return 'housekeeping_supervisor';
    case 'hr':
      return 'hr_supervisor';
    case 'hr_supervisor':
    case 'operations_supervisor':
    case 'housekeeping_supervisor':
      return 'admin';
    default:
      return null;
  }
}

function isLineManager(actor, staff) {
  if (!actor || !staff) return false;
  if (String(actor.id) === String(staff.id)) return false;
  if (staff.manager_id != null && String(actor.id) === String(staff.manager_id)) return true;
  const dept = departmentManagerRole(staff.role);
  return Boolean(dept) && actor.role === dept;
}

function canViewAllStaffRequests(actor) {
  return actor?.role === 'admin' || isHrTeamRole(actor?.role);
}

function eligibleReviewSlots(actor, request, staff) {
  if (!actor || !request || request.status !== 'pending') return [];
  if (String(actor.id) === String(request.staff_user_id || staff?.id)) return [];
  if (actor.role === 'admin') return ['admin'];
  const slots = [];
  const needsManager = request.needs_manager_approval !== false;
  const needsHr = request.needs_hr_approval !== false;
  const managerDone = Boolean(request.manager_reviewed_by);
  const hrDone = Boolean(request.hr_reviewed_by);
  if (needsManager && !managerDone && isLineManager(actor, staff || { id: request.staff_user_id, role: request.role, manager_id: request.manager_id })) {
    slots.push('manager');
  }
  if (needsHr && !hrDone && actor.role === 'hr_supervisor') {
    slots.push('hr');
  }
  return slots;
}

function applyRequestReview(request, actor, decision, staff) {
  const status = String(decision || '').toLowerCase();
  if (status !== 'approved' && status !== 'rejected') {
    const err = new Error('Status must be approved or rejected');
    err.status = 400;
    throw err;
  }
  const slots = eligibleReviewSlots(actor, request, staff);
  if (!slots.length) {
    const err = new Error(
      'Only the staff manager, HR Supervisor, or an admin can review this request'
    );
    err.status = 403;
    throw err;
  }

  const next = {
    manager_reviewed_by: request.manager_reviewed_by || null,
    hr_reviewed_by: request.hr_reviewed_by || null,
    reviewed_by: actor.id,
    status: 'pending',
    finalized: false,
    slots,
  };

  if (status === 'rejected') {
    next.status = 'rejected';
    next.finalized = true;
    if (slots.includes('admin') || slots.includes('manager')) next.manager_reviewed_by = actor.id;
    if (slots.includes('admin') || slots.includes('hr')) next.hr_reviewed_by = actor.id;
    return next;
  }

  if (slots.includes('admin')) {
    if (request.needs_manager_approval !== false) next.manager_reviewed_by = actor.id;
    if (request.needs_hr_approval !== false) next.hr_reviewed_by = actor.id;
    next.status = 'approved';
    next.finalized = true;
    return next;
  }

  if (slots.includes('manager')) next.manager_reviewed_by = actor.id;
  if (slots.includes('hr')) next.hr_reviewed_by = actor.id;

  const managerOk = request.needs_manager_approval === false || next.manager_reviewed_by;
  const hrOk = request.needs_hr_approval === false || next.hr_reviewed_by;
  if (managerOk && hrOk) {
    next.status = 'approved';
    next.finalized = true;
  }
  return next;
}

function describeRequestApproval(request) {
  if (request.status === 'approved') return 'Approved';
  if (request.status === 'rejected') return 'Rejected';
  const waiting = [];
  if (request.needs_manager_approval && !request.manager_reviewed_by) waiting.push('manager');
  if (request.needs_hr_approval && !request.hr_reviewed_by) waiting.push('HR Supervisor');
  if (!waiting.length) return 'Pending';
  return `Waiting for ${waiting.join(' & ')}`;
}

function isPenaltyCategory(category) {
  return PENALTY_CATEGORIES.includes(String(category || '').toLowerCase());
}

function splitSalaryAdjustments(deductionRows = []) {
  const penalties = [];
  const deductions = [];
  for (const row of deductionRows) {
    if (isPenaltyCategory(row.category)) penalties.push(row);
    else deductions.push(row);
  }
  const sum = (rows) => roundMoney(rows.reduce((acc, r) => acc + (Number(r.amount) || 0), 0));
  return {
    penalties,
    deductions,
    penalties_total: sum(penalties),
    deductions_total: sum(deductions),
  };
}

module.exports = {
  DAYS_IN_MONTH,
  SHIFT_START_MINUTES,
  GRACE_END_MINUTES,
  LATE_QUARTER_END,
  LATE_HALF_END,
  ANNUAL_MIN_NOTICE_DAYS,
  EARLY_LEAVE_MAX_PER_YEAR,
  TIMEZONE,
  roundMoney,
  dailyRate,
  parseHhMm,
  latenessFactor,
  absenceFactor,
  computeLatenessDeduction,
  computeAbsenceDeduction,
  cairoParts,
  addDaysIso,
  assertCasualTiming,
  assertAnnualNotice,
  assertEarlyLeaveTiming,
  HOLIDAY_ACCESS_MONTHS,
  monthsBetween,
  canRequestHolidays,
  HR_TEAM_ROLES,
  isHrTeamRole,
  isHrActingOnSelf,
  appliesSalaryImmediately,
  canEditStaffCompensation,
  assertCanEditStaffCompensation,
  assertHrNotEditingOwnCompensation,
  nextPayrollPeriod,
  dateCoveredByRanges,
  parseAttendanceRows,
  parseHtmlExcelTables,
  collapsePunchAttendance,
  fillMissingOfficeAbsences,
  isDoorPunchLog,
  normalizePersonId,
  matchAttendanceStaff,
  excelTimeToHhMm,
  computeHalfDayDeduction,
  PENALTY_CATEGORIES,
  NO_OFFICE_ATTENDANCE_ROLES,
  NO_STAFF_BENEFIT_ROLES,
  hasOfficeAttendance,
  isFieldOperationsRole,
  canRequestStaffBenefits,
  staffRequestPolicy,
  departmentManagerRole,
  isLineManager,
  canViewAllStaffRequests,
  eligibleReviewSlots,
  applyRequestReview,
  describeRequestApproval,
  isPenaltyCategory,
  splitSalaryAdjustments,
};
