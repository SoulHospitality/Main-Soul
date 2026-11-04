/**
 * Payroll rules HR builds on the HR rules page — no code needed.
 *
 * A rule = WHEN (trigger + settings) → HOW MUCH (amount type × value, per occurrence/hour/cycle)
 *        → WHO (everyone, some roles, or named people), as a deduction or a bonus.
 *
 * Each pay cycle the engine reads attendance and approved leave, evaluates every active rule per
 * person, and writes one deduction/bonus row per rule per person (tagged rule_id + rule_period).
 * Re-running replaces those rows, so editing a rule updates every unpaid payroll. Paid cycles are
 * never touched.
 */
const { dailyRate, hourlyRate, roundMoney, isScheduledDayOff, excuseHoursFromTimes } = require('./hrRules');

const TRIGGERS = {
  late_arrival: { unit: 'day', group: 'attendance', label: 'Each late arrival' },
  no_show: { unit: 'day', group: 'attendance', label: 'Each no-show' },
  early_checkout: { unit: 'day', group: 'attendance', label: 'Each early check-out' },
  overtime: { unit: 'hour', group: 'attendance', label: 'Each hour after a time' },
  worked_day_off: { unit: 'day', group: 'attendance', label: 'Each day worked on a day off' },
  late_count: { unit: 'cycle', group: 'attendance', label: 'Late N or more times in the cycle' },
  absence_count: { unit: 'cycle', group: 'attendance', label: 'No-show N or more times in the cycle' },
  perfect_attendance: { unit: 'cycle', group: 'attendance', label: 'Perfect attendance in the cycle' },
  leave_days: { unit: 'day', group: 'leave', label: 'Each approved leave day of a type' },
  excuse_hours: { unit: 'hour', group: 'leave', label: 'Each approved excuse hour of a type' },
  monthly_fixed: { unit: 'cycle', group: 'fixed', label: 'Every pay cycle (fixed)' },
  tenure: { unit: 'cycle', group: 'fixed', label: 'Every cycle after N months of service' },
};

const AMOUNT_TYPES = ['daily_rate', 'hourly_rate', 'fixed', 'percent_base'];
const EFFECTS = ['deduction', 'bonus'];
const LEAVE_TYPES = [
  'casual', 'annual', 'sick', 'unpaid', 'holiday', 'day_off', 'mission', 'meeting',
  'paid_excuse', 'unpaid_excuse', 'early_leave',
];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOf(value) {
  const m = String(value || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function isoOf(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function daysBetweenInclusive(fromIso, toIso) {
  const out = [];
  const d = new Date(`${fromIso}T12:00:00Z`);
  const end = new Date(`${toIso}T12:00:00Z`);
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function monthsOfService(startIso, atIso) {
  if (!startIso) return 0;
  const a = new Date(`${startIso}T12:00:00Z`);
  const b = new Date(`${atIso}T12:00:00Z`);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

function fail(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/** Validates and normalises a rule coming from the HR rules page. */
function sanitizeRule(input = {}) {
  const name = String(input.name || '').trim().slice(0, 120);
  if (name.length < 2) throw fail('Give the rule a name');
  const effect = EFFECTS.includes(input.effect) ? input.effect : null;
  if (!effect) throw fail('Choose deduction or bonus');
  const trigger = TRIGGERS[input.trigger] ? input.trigger : null;
  if (!trigger) throw fail('Choose when the rule applies');
  const amountType = AMOUNT_TYPES.includes(input.amount_type) ? input.amount_type : null;
  if (!amountType) throw fail('Choose how the amount is worked out');
  const amount = Number(input.amount);
  const maxAmount = amountType === 'fixed' ? 1_000_000 : amountType === 'percent_base' ? 100 : 30;
  if (!Number.isFinite(amount) || amount <= 0 || amount > maxAmount) {
    throw fail(`The amount must be more than 0 and at most ${maxAmount}`);
  }

  const raw = input.params && typeof input.params === 'object' ? input.params : {};
  const params = {};
  const time = (key, required) => {
    const v = String(raw[key] || '').trim();
    if (!v && !required) return;
    if (!HHMM.test(v)) throw fail('Times must be HH:MM (24-hour)');
    params[key] = v;
  };
  const count = (key) => {
    const v = Number(raw[key]);
    if (!Number.isInteger(v) || v < 1 || v > 400) throw fail('The count must be a whole number from 1');
    params[key] = v;
  };
  const leaveType = () => {
    if (!LEAVE_TYPES.includes(raw.leave_type)) throw fail('Choose a leave type');
    params.leave_type = raw.leave_type;
  };
  switch (trigger) {
    case 'late_arrival':
      time('after', true);
      time('before', false);
      break;
    case 'no_show':
      params.notified = ['yes', 'no'].includes(raw.notified) ? raw.notified : 'any';
      break;
    case 'early_checkout':
      time('before', true);
      break;
    case 'overtime':
      time('after', true);
      break;
    case 'late_count':
      time('after', false);
      count('min_count');
      break;
    case 'absence_count':
    case 'tenure':
      count(trigger === 'tenure' ? 'min_months' : 'min_count');
      break;
    case 'leave_days':
    case 'excuse_hours':
      leaveType();
      break;
    default:
      break;
  }

  const ints = (list) =>
    Array.isArray(list) ? [...new Set(list.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
  const roles = Array.isArray(input.roles)
    ? [...new Set(input.roles.map((r) => String(r).trim()).filter((r) => /^[a-z_]{2,40}$/.test(r)))]
    : [];
  const freeCount = input.free_count === '' || input.free_count == null ? 0 : Number(input.free_count);
  if (!Number.isInteger(freeCount) || freeCount < 0 || freeCount > 400) throw fail('Free occurrences must be 0 or more');
  const cap = input.cap_amount === '' || input.cap_amount == null ? null : Number(input.cap_amount);
  if (cap != null && (!Number.isFinite(cap) || cap <= 0)) throw fail('The cap must be more than 0');
  const date = (v) => {
    const text = String(v || '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  };
  const effectiveFrom = date(input.effective_from);
  const effectiveTo = date(input.effective_to);
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) throw fail('The end date is before the start date');

  return {
    name,
    effect,
    trigger,
    params,
    amount_type: amountType,
    amount,
    roles,
    staff_ids: ints(input.staff_ids),
    free_count: freeCount,
    cap_amount: cap,
    effective_from: effectiveFrom,
    effective_to: effectiveTo,
    active: input.active === undefined ? true : Boolean(input.active),
    notes: input.notes ? String(input.notes).slice(0, 500) : null,
  };
}

function ruleAppliesTo(rule, staff) {
  const ids = rule.staff_ids || [];
  if (ids.length) return ids.map(Number).includes(Number(staff.id));
  const roles = rule.roles || [];
  return !roles.length || roles.includes(staff.role);
}

function ruleActiveInPeriod(rule, period) {
  if (!rule.active) return false;
  const from = isoOf(rule.effective_from);
  const to = isoOf(rule.effective_to);
  if (from && from > period.through) return false;
  if (to && to < period.from) return false;
  return true;
}

function unitAmount(rule, baseSalary) {
  const amount = Number(rule.amount) || 0;
  switch (rule.amount_type) {
    case 'daily_rate':
      return dailyRate(baseSalary) * amount;
    case 'hourly_rate':
      return hourlyRate(baseSalary) * amount;
    case 'percent_base':
      return (Number(baseSalary) || 0) * (amount / 100);
    default:
      return amount;
  }
}

/** How many times (or hours) the trigger fired for one person in the cycle, plus the dates. */
function measure(rule, ctx) {
  const p = rule.params || {};
  const { attendance = [], leaves = [], staff, period } = ctx;
  const inPeriod = (iso) => iso >= period.from && iso <= period.through;
  const days = attendance.filter((a) => inPeriod(isoOf(a.work_date)));
  const worked = days.filter((a) => a.status === 'on_time' || a.status === 'late');

  switch (rule.trigger) {
    case 'late_arrival': {
      const after = minutesOf(p.after);
      const before = minutesOf(p.before);
      const hits = worked.filter((a) => {
        const m = minutesOf(a.check_in);
        return m != null && m > after && (before == null || m <= before);
      });
      return { quantity: hits.length, dates: hits.map((a) => isoOf(a.work_date)) };
    }
    case 'no_show': {
      const hits = days.filter(
        (a) =>
          a.status === 'no_show' &&
          (p.notified === 'any' || !p.notified || (p.notified === 'yes') === Boolean(a.notified))
      );
      return { quantity: hits.length, dates: hits.map((a) => isoOf(a.work_date)) };
    }
    case 'early_checkout': {
      const before = minutesOf(p.before);
      const hits = worked.filter((a) => {
        const m = minutesOf(a.check_out);
        return m != null && m < before;
      });
      return { quantity: hits.length, dates: hits.map((a) => isoOf(a.work_date)) };
    }
    case 'overtime': {
      const after = minutesOf(p.after);
      let minutes = 0;
      const dates = [];
      for (const a of worked) {
        const m = minutesOf(a.check_out);
        if (m != null && m > after) {
          minutes += m - after;
          dates.push(isoOf(a.work_date));
        }
      }
      return { quantity: Math.floor((minutes / 60) * 4) / 4, dates };
    }
    case 'worked_day_off': {
      const hits = worked.filter((a) => isScheduledDayOff(staff.days_off, isoOf(a.work_date)));
      return { quantity: hits.length, dates: hits.map((a) => isoOf(a.work_date)) };
    }
    case 'late_count': {
      const after = minutesOf(p.after);
      const lates =
        after == null
          ? worked.filter((a) => a.status === 'late')
          : worked.filter((a) => {
              const m = minutesOf(a.check_in);
              return m != null && m > after;
            });
      return { quantity: lates.length >= p.min_count ? 1 : 0, dates: lates.map((a) => isoOf(a.work_date)), seen: lates.length };
    }
    case 'absence_count': {
      const misses = days.filter((a) => a.status === 'no_show');
      return { quantity: misses.length >= p.min_count ? 1 : 0, dates: misses.map((a) => isoOf(a.work_date)), seen: misses.length };
    }
    case 'perfect_attendance': {
      const clean = days.length > 0 && days.every((a) => a.status === 'on_time');
      return { quantity: clean ? 1 : 0, dates: [] };
    }
    case 'leave_days': {
      const dates = [];
      for (const l of leaves) {
        if (l.status !== 'approved' || l.leave_type !== p.leave_type) continue;
        for (const iso of daysBetweenInclusive(isoOf(l.start_date), isoOf(l.end_date))) {
          if (inPeriod(iso)) dates.push(iso);
        }
      }
      const unique = [...new Set(dates)];
      return { quantity: unique.length, dates: unique };
    }
    case 'excuse_hours': {
      let hours = 0;
      const dates = [];
      for (const l of leaves) {
        if (l.status !== 'approved' || l.leave_type !== p.leave_type) continue;
        const iso = isoOf(l.start_date);
        if (!inPeriod(iso)) continue;
        let h = Number(l.hours);
        if (!Number.isFinite(h) || h <= 0) {
          try {
            h = excuseHoursFromTimes(l.start_time, l.end_time);
          } catch {
            h = 0;
          }
        }
        if (h > 0) {
          hours += h;
          dates.push(iso);
        }
      }
      return { quantity: Math.round(hours * 100) / 100, dates };
    }
    case 'monthly_fixed':
      return { quantity: 1, dates: [] };
    case 'tenure': {
      const months = monthsOfService(isoOf(staff.start_date || staff.created_at), period.through);
      return { quantity: months >= p.min_months ? 1 : 0, dates: [], seen: months };
    }
    default:
      return { quantity: 0, dates: [] };
  }
}

const UNIT_WORDS = { day: ['time', 'times'], hour: ['hour', 'hours'], cycle: ['', ''] };

/** Evaluates one rule for one person: null when it does not apply or adds up to nothing. */
function evaluateRule(rule, ctx) {
  if (!ruleActiveInPeriod(rule, ctx.period) || !ruleAppliesTo(rule, ctx.staff)) return null;
  const { quantity: measured, dates } = measure(rule, ctx);
  const free = TRIGGERS[rule.trigger]?.unit === 'cycle' ? 0 : Number(rule.free_count) || 0;
  const quantity = Math.max(0, measured - free);
  if (quantity <= 0) return null;
  const unit = unitAmount(rule, ctx.staff.base_salary);
  let amount = roundMoney(unit * quantity);
  const capped = rule.cap_amount != null && amount > Number(rule.cap_amount);
  if (capped) amount = roundMoney(Number(rule.cap_amount));
  if (amount <= 0) return null;

  const kind = TRIGGERS[rule.trigger]?.unit || 'cycle';
  const words = UNIT_WORDS[kind];
  let detail = kind === 'cycle' ? '' : ` · ${quantity} ${quantity === 1 ? words[0] : words[1]}`;
  if (free && measured > 0) detail += ` (first ${free} free)`;
  if (capped) detail += ' (capped)';
  return {
    rule_id: rule.id,
    effect: rule.effect,
    amount,
    quantity,
    dates,
    reason: `${rule.name}${detail}`.slice(0, 255),
  };
}

/** Every rule result for every person in the cycle (pure; used for previews and for applying). */
function evaluatePeriod(rules, staffList, data, period) {
  const results = [];
  for (const staff of staffList) {
    const ctx = {
      staff,
      period,
      attendance: data.attendanceByStaff.get(Number(staff.id)) || [],
      leaves: data.leavesByStaff.get(Number(staff.id)) || [],
    };
    for (const rule of rules) {
      const hit = evaluateRule(rule, ctx);
      if (hit) results.push({ ...hit, staff_user_id: staff.id, full_name: staff.full_name, role: staff.role });
    }
  }
  return results;
}

/** Deductions from attendance/leave triggers count as penalties on the payslip; fixed ones as deductions. */
function deductionCategory(trigger) {
  return TRIGGERS[trigger]?.group === 'fixed' ? 'other' : 'penalty';
}

function periodKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = Number(row[key]);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

/** Loads rules, staff, attendance and leave for a cycle. `staffIds` narrows it to some people. */
async function loadPeriodData(query, period, staffIds = null, rulesOverride = null) {
  const staffFilter = staffIds?.length ? 'AND u.id = ANY($1::int[])' : '';
  const staffParams = staffIds?.length ? [staffIds] : [];
  const [{ rows: rules }, { rows: staff }] = await Promise.all([
    rulesOverride
      ? Promise.resolve({ rows: rulesOverride })
      : query(`SELECT * FROM hr_payroll_rules WHERE active = true ORDER BY sort_order, id`),
    query(
      `SELECT u.id, u.full_name, u.role, COALESCE(u.base_salary, 0)::float AS base_salary,
              u.days_off, u.created_at::date AS start_date
       FROM staff_users u
       WHERE u.is_active = 1 AND u.role NOT IN ('owner', 'admin') ${staffFilter}
       ORDER BY u.full_name`,
      staffParams
    ),
  ]);
  const ids = staff.map((s) => s.id);
  if (!ids.length || !rules.length) return { rules, staff, data: { attendanceByStaff: new Map(), leavesByStaff: new Map() } };
  const [{ rows: attendance }, { rows: leaves }] = await Promise.all([
    query(
      `SELECT staff_user_id, work_date::text AS work_date, status, check_in, check_out, notified
       FROM staff_attendance
       WHERE staff_user_id = ANY($1::int[]) AND work_date >= $2::date AND work_date <= $3::date`,
      [ids, period.from, period.through]
    ),
    query(
      `SELECT staff_user_id, leave_type, start_date::text AS start_date, end_date::text AS end_date,
              hours, start_time::text AS start_time, end_time::text AS end_time, status
       FROM staff_leave_requests
       WHERE staff_user_id = ANY($1::int[]) AND status = 'approved'
         AND start_date <= $3::date AND end_date >= $2::date`,
      [ids, period.from, period.through]
    ),
  ]);
  return {
    rules,
    staff,
    data: { attendanceByStaff: groupBy(attendance, 'staff_user_id'), leavesByStaff: groupBy(leaves, 'staff_user_id') },
  };
}

/**
 * Writes rule results into payroll for one cycle: replaces this cycle's rule rows for everyone
 * whose payroll is not yet paid. Returns the results that were written.
 */
async function applyPayrollRules({ pool, query, year, month, from, through, staffIds = null }) {
  const period = { from, through };
  const key = periodKey(year, month);
  const { rules, staff, data } = await loadPeriodData(query, period, staffIds);

  const { rows: paidRows } = await query(
    `SELECT staff_user_id FROM staff_payroll_entries WHERE period_year = $1 AND period_month = $2 AND status = 'paid'`,
    [year, month]
  );
  const paid = new Set(paidRows.map((r) => Number(r.staff_user_id)));
  const open = staff.filter((s) => !paid.has(Number(s.id)));
  const openIds = open.map((s) => s.id);
  if (!openIds.length) return { period: key, results: [], skipped_paid: paid.size };

  const results = evaluatePeriod(rules, open, data, period);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM staff_salary_deductions WHERE rule_period = $1 AND rule_id IS NOT NULL AND staff_user_id = ANY($2::int[])`,
      [key, openIds]
    );
    await client.query(
      `DELETE FROM staff_salary_bonuses WHERE rule_period = $1 AND rule_id IS NOT NULL AND staff_user_id = ANY($2::int[])`,
      [key, openIds]
    );
    const triggerOf = new Map(rules.map((r) => [Number(r.id), r.trigger]));
    for (const r of results) {
      if (r.effect === 'bonus') {
        await client.query(
          `INSERT INTO staff_salary_bonuses (staff_user_id, amount, reason, bonus_date, rule_id, rule_period)
           VALUES ($1, $2, $3, $4::date, $5, $6)`,
          [r.staff_user_id, r.amount, r.reason, through, r.rule_id, key]
        );
      } else {
        await client.query(
          `INSERT INTO staff_salary_deductions (staff_user_id, amount, reason, deduction_date, category, rule_id, rule_period)
           VALUES ($1, $2, $3, $4::date, $5, $6, $7)`,
          [r.staff_user_id, r.amount, r.reason, through, deductionCategory(triggerOf.get(Number(r.rule_id))), r.rule_id, key]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { period: key, results, skipped_paid: paid.size };
}

/** Dry run for the HR rules page: what each rule would add this cycle, without writing anything. */
async function previewPayrollRules({ query, from, through, ruleOverride = null }) {
  const period = { from, through };
  const override = ruleOverride ? [{ ...ruleOverride, id: ruleOverride.id || 0, active: true }] : null;
  const { rules, staff, data } = await loadPeriodData(query, period, null, override);
  return evaluatePeriod(rules, staff, data, period);
}

module.exports = {
  TRIGGERS,
  AMOUNT_TYPES,
  LEAVE_TYPES,
  sanitizeRule,
  evaluateRule,
  evaluatePeriod,
  applyPayrollRules,
  previewPayrollRules,
  periodKey,
  monthsOfService,
};
